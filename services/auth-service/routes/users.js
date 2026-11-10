const express = require("express");
const bcrypt = require("bcryptjs");
const { pool, transaction } = require("../db");
const { authenticate, allowRoles } = require("../middleware/auth");
const {
  asyncHandler,
  fail,
  text,
  normalizeEmail,
  validPassword,
  validUuid,
  readDepartment,
  publicUser,
} = require("../utils");

const router = express.Router();

const MEMBER_ROLES = ["manager", "gate_operator", "viewer"];

router.use(authenticate, allowRoles("super_admin", "org_admin"));

function allowedRoles(user) {
  return user.role === "super_admin"
    ? ["org_admin", ...MEMBER_ROLES]
    : MEMBER_ROLES;
}

function getOrganizationId(req, suppliedId) {
  if (req.user.role === "super_admin") {
    if (!validUuid(suppliedId)) {
      fail(400, "A valid organization_id is required.");
    }

    return suppliedId;
  }

  if (
    suppliedId !== undefined &&
    suppliedId !== req.user.organization_id
  ) {
    fail(403, "You cannot access another organization.");
  }

  return req.user.organization_id;
}

function checkTarget(actor, target) {
  if (!target) {
    fail(404, "User not found.");
  }

  if (target.id === actor.id) {
    fail(403, "Use a separate account settings route for your account.");
  }

  if (target.role === "super_admin") {
    fail(403, "Super admins cannot be managed through this route.");
  }

  if (
    actor.role === "org_admin" &&
    (
      target.organization_id !== actor.organization_id ||
      !MEMBER_ROLES.includes(target.role)
    )
  ) {
    fail(403, "You cannot manage this user.");
  }
}

// List users with pagination.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const organizationId = getOrganizationId(
      req,
      req.query.organization_id
    );

    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);

    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      fail(400, "Limit must be 1–100 and offset must be a non-negative integer.");
    }

    const result = await pool.query(
      `SELECT id, organization_id, full_name, email, role,
              department, is_active, last_login_at, created_at
       FROM auth.users
       WHERE organization_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [organizationId, limit, offset]
    );

    res.json({
      users: result.rows,
      limit,
      offset,
    });
  })
);

// Create an organization user.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    const organizationId = getOrganizationId(
      req,
      body.organization_id
    );

    const fullName = text(body.full_name, 100);
    const email = normalizeEmail(body.email);
    const department = readDepartment(body.department);

    if (!fullName || !email || !validPassword(body.password)) {
      fail(400, "Provide a valid full name, email, and password.");
    }

    if (!allowedRoles(req.user).includes(body.role)) {
      fail(403, "You cannot assign this role.");
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const user = await transaction(async (client) => {
      const organizationResult = await client.query(
        `SELECT id, status
         FROM auth.organizations
         WHERE id = $1
         FOR SHARE`,
        [organizationId]
      );

      const organization = organizationResult.rows[0];

      if (!organization) {
        fail(404, "Organization not found.");
      }

      if (organization.status !== "active") {
        fail(403, "Cannot create users for a suspended organization.");
      }

      const result = await client.query(
        `INSERT INTO auth.users
           (organization_id, full_name, email, password_hash,
            role, department)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          organizationId,
          fullName,
          email,
          passwordHash,
          body.role,
          department,
        ]
      );

      return publicUser(result.rows[0]);
    });

    res.status(201).json({ user });
  })
);

// Update or deactivate an organization user.
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!validUuid(req.params.id)) {
      fail(400, "Invalid user ID.");
    }

    const body = req.body || {};

    const editableFields = [
      "full_name",
      "email",
      "password",
      "role",
      "department",
      "is_active",
    ];

    const keys = Object.keys(body);

    if (
      keys.length === 0 ||
      keys.some((key) => !editableFields.includes(key))
    ) {
      fail(400, "Provide only supported user fields.");
    }

    const updates = {};

    if ("full_name" in body) {
      updates.full_name = text(body.full_name, 100);

      if (!updates.full_name) {
        fail(400, "Invalid full name.");
      }
    }

    if ("email" in body) {
      updates.email = normalizeEmail(body.email);

      if (!updates.email) {
        fail(400, "Invalid email.");
      }
    }

    if ("role" in body) {
      if (!allowedRoles(req.user).includes(body.role)) {
        fail(403, "You cannot assign this role.");
      }

      updates.role = body.role;
    }

    if ("department" in body) {
      updates.department = readDepartment(body.department);
    }

    if ("is_active" in body) {
      if (typeof body.is_active !== "boolean") {
        fail(400, "is_active must be true or false.");
      }

      updates.is_active = body.is_active;
    }

    if ("password" in body) {
      if (!validPassword(body.password)) {
        fail(400, "Password must contain at least 12 characters and at most 72 bytes.");
      }

      updates.password_hash = await bcrypt.hash(body.password, 12);
    }

    const revokeSessions = keys.some((key) =>
      ["email", "password", "role", "is_active"].includes(key)
    );

    const user = await transaction(async (client) => {
      const result = await client.query(
        `SELECT *
         FROM auth.users
         WHERE id = $1
           AND ($2::uuid IS NULL OR organization_id = $2::uuid)
         FOR UPDATE`,
        [
          req.params.id,
          req.user.role === "super_admin"
            ? null
            : req.user.organization_id,
        ]
      );

      const target = result.rows[0];

      checkTarget(req.user, target);

      const nextUser = { ...target, ...updates };

      const updatedResult = await client.query(
        `UPDATE auth.users
         SET full_name = $1,
             email = $2,
             password_hash = $3,
             role = $4,
             department = $5,
             is_active = $6
         WHERE id = $7
         RETURNING *`,
        [
          nextUser.full_name,
          nextUser.email,
          nextUser.password_hash,
          nextUser.role,
          nextUser.department,
          nextUser.is_active,
          target.id,
        ]
      );

      if (revokeSessions) {
        await client.query(
          `UPDATE auth.refresh_tokens
           SET revoked_at = NOW()
           WHERE user_id = $1
             AND revoked_at IS NULL`,
          [target.id]
        );
      }

      return publicUser(updatedResult.rows[0]);
    });

    res.json({
      user,
      sessions_revoked: revokeSessions,
    });
  })
);

module.exports = router;