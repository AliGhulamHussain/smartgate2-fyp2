// Team members: the people who log in to the dashboard.
// Only admins use these routes. An org_admin manages managers, gate
// operators and viewers in their own organization. A super_admin (platform
// owner) can manage any organization and also create org_admins.
const express = require("express");
const bcrypt = require("bcryptjs");
const { pool, transaction } = require("../db");
const { authenticate, allowRoles } = require("../auth");
const {
  asyncHandler,
  fail,
  isUuid,
  readText,
  readEmail,
  isValidPassword,
  readDepartment,
} = require("../helpers");
const { publicUser } = require("../sessions");

const router = express.Router();
router.use(authenticate, allowRoles("super_admin", "org_admin"));

const MEMBER_ROLES = ["manager", "gate_operator", "viewer"];

// Roles the current admin is allowed to give.
function rolesAllowedFor(admin) {
  return admin.role === "super_admin" ? ["org_admin", ...MEMBER_ROLES] : MEMBER_ROLES;
}

// Which organization the request is about. An org_admin can only use their
// own; a super_admin must say which one.
function chooseOrganization(req, requestedId) {
  if (req.user.role === "super_admin") {
    if (!isUuid(requestedId)) {
      fail(400, "A valid organization_id is required.");
    }
    return requestedId;
  }

  if (requestedId !== undefined && requestedId !== req.user.organization_id) {
    fail(403, "You cannot access another organization.");
  }
  return req.user.organization_id;
}

// May this admin edit this user?
function checkCanManage(admin, target) {
  if (!target) {
    fail(404, "User not found.");
  }
  if (target.id === admin.id) {
    fail(403, "Use a separate account settings route for your account.");
  }
  if (target.role === "super_admin") {
    fail(403, "Super admins cannot be managed through this route.");
  }
  if (
    admin.role === "org_admin" &&
    (target.organization_id !== admin.organization_id || !MEMBER_ROLES.includes(target.role))
  ) {
    fail(403, "You cannot manage this user.");
  }
}

// GET /api/users?limit=&offset=   (newest first)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const organizationId = chooseOrganization(req, req.query.organization_id);

    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);

    if (
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0
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

    res.json({ users: result.rows, limit, offset });
  })
);

// POST /api/users
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const organizationId = chooseOrganization(req, body.organization_id);

    const fullName = readText(body.full_name, 100);
    const email = readEmail(body.email);
    const department = readDepartment(body.department);

    if (!fullName || !email || !isValidPassword(body.password)) {
      fail(400, "Provide a valid full name, email, and password.");
    }
    if (!rolesAllowedFor(req.user).includes(body.role)) {
      fail(403, "You cannot assign this role.");
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const user = await transaction(async (client) => {
      // FOR SHARE stops the organization being suspended while we add the user.
      const org = await client.query(
        "SELECT id, status FROM auth.organizations WHERE id = $1 FOR SHARE",
        [organizationId]
      );

      if (!org.rows[0]) {
        fail(404, "Organization not found.");
      }
      if (org.rows[0].status !== "active") {
        fail(403, "Cannot create users for a suspended organization.");
      }

      const result = await client.query(
        `INSERT INTO auth.users
           (organization_id, full_name, email, password_hash, role, department)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [organizationId, fullName, email, passwordHash, body.role, department]
      );

      return publicUser(result.rows[0]);
    });

    res.status(201).json({ user });
  })
);

// PATCH /api/users/:id
// Changes only the fields that are sent. Changing email, password, role or
// is_active logs the user out everywhere (all their sessions are revoked).
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) {
      fail(400, "Invalid user ID.");
    }

    const body = req.body || {};
    const keys = Object.keys(body);
    const editable = ["full_name", "email", "password", "role", "department", "is_active"];

    if (keys.length === 0 || keys.some((key) => !editable.includes(key))) {
      fail(400, "Provide only supported user fields.");
    }

    const updates = {};

    if ("full_name" in body) {
      updates.full_name = readText(body.full_name, 100);
      if (!updates.full_name) fail(400, "Invalid full name.");
    }

    if ("email" in body) {
      updates.email = readEmail(body.email);
      if (!updates.email) fail(400, "Invalid email.");
    }

    if ("role" in body) {
      if (!rolesAllowedFor(req.user).includes(body.role)) {
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
      if (!isValidPassword(body.password)) {
        fail(400, "Password must contain at least 12 characters and at most 72 bytes.");
      }
      updates.password_hash = await bcrypt.hash(body.password, 12);
    }

    const revokeSessions = keys.some((key) =>
      ["email", "password", "role", "is_active"].includes(key)
    );

    const user = await transaction(async (client) => {
      // An org_admin only finds users in their own organization.
      const found = await client.query(
        `SELECT * FROM auth.users
         WHERE id = $1 AND ($2::uuid IS NULL OR organization_id = $2::uuid)
         FOR UPDATE`,
        [req.params.id, req.user.role === "super_admin" ? null : req.user.organization_id]
      );
      const target = found.rows[0];

      checkCanManage(req.user, target);

      const next = { ...target, ...updates };

      const updated = await client.query(
        `UPDATE auth.users
         SET full_name = $1, email = $2, password_hash = $3,
             role = $4, department = $5, is_active = $6
         WHERE id = $7
         RETURNING *`,
        [next.full_name, next.email, next.password_hash, next.role, next.department, next.is_active, target.id]
      );

      if (revokeSessions) {
        await client.query(
          `UPDATE auth.refresh_tokens
           SET revoked_at = NOW()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [target.id]
        );
      }

      return publicUser(updated.rows[0]);
    });

    res.json({ user, sessions_revoked: revokeSessions });
  })
);

module.exports = { router };
