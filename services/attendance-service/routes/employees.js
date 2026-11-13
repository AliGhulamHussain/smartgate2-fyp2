const express = require("express");
const { pool } = require("../db");
const {
  authenticate,
  requireOrganization,
  allowRoles,
} = require("../middleware/auth");
const { asyncHandler, fail, validUuid, readEmployee } = require("../utils");

const router = express.Router();

router.use(authenticate, requireOrganization);

const COLUMNS = `id, organization_id, employee_code, full_name, email, phone,
                 department, designation, status, presence, face_enrolled,
                 created_at, updated_at`;

// Turns a duplicate employee_code into a safe 409.
function failOnDuplicate(error) {
  if (error.code === "23505") {
    fail(409, "An employee with this employee_code already exists.");
  }
  throw error;
}

function readId(req) {
  if (!validUuid(req.params.id)) {
    fail(400, "Employee id must be a valid UUID.");
  }
  return req.params.id;
}

function readQueryText(value, name, max) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length > max) {
    fail(400, `${name} must be text of at most ${max} characters.`);
  }
  return value.trim() || undefined;
}

function readPositiveInt(value, name, fallback, max) {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!/^\d+$/.test(String(value)) || number < 1 || number > max) {
    fail(400, `${name} must be an integer from 1 to ${max}.`);
  }
  return number;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = readPositiveInt(req.query.page, "page", 1, 100000);
    const limit = readPositiveInt(req.query.limit, "limit", 20, 100);
    const search = readQueryText(req.query.search, "search", 100);
    const department = readQueryText(req.query.department, "department", 100);
    const status = readQueryText(req.query.status, "status", 10);
    const presence = readQueryText(req.query.presence, "presence", 10);

    if (status && !["active", "inactive"].includes(status)) {
      fail(400, "status must be active or inactive.");
    }
    if (presence && !["inside", "outside"].includes(presence)) {
      fail(400, "presence must be inside or outside.");
    }

    // Every query starts with the caller's organization.
    const conditions = ["organization_id = $1"];
    const values = [req.user.organization_id];

    if (search) {
      // Escape LIKE wildcards so the search is literal.
      values.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      conditions.push(
        `(full_name ILIKE $${values.length} OR employee_code ILIKE $${values.length})`
      );
    }
    if (department) {
      values.push(department);
      conditions.push(`LOWER(department) = LOWER($${values.length})`);
    }
    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
    if (presence) {
      values.push(presence);
      conditions.push(`presence = $${values.length}`);
    }

    const where = conditions.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM attendance.employees WHERE ${where}`,
      values
    );

    const listResult = await pool.query(
      `SELECT ${COLUMNS}
       FROM attendance.employees
       WHERE ${where}
       ORDER BY full_name, employee_code
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit]
    );

    res.json({
      employees: listResult.rows,
      page,
      limit,
      total: countResult.rows[0].total,
    });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = readId(req);

    const result = await pool.query(
      `SELECT ${COLUMNS}
       FROM attendance.employees
       WHERE id = $1 AND organization_id = $2`,
      [id, req.user.organization_id]
    );

    if (!result.rows[0]) {
      fail(404, "Employee not found.");
    }

    res.json({ employee: result.rows[0] });
  })
);

router.post(
  "/",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const employee = readEmployee(req.body);

    const result = await pool
      .query(
        `INSERT INTO attendance.employees
           (organization_id, employee_code, full_name, email, phone,
            department, designation)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${COLUMNS}`,
        [
          req.user.organization_id,
          employee.employee_code,
          employee.full_name,
          employee.email ?? null,
          employee.phone ?? null,
          employee.department ?? null,
          employee.designation ?? null,
        ]
      )
      .catch(failOnDuplicate);

    res.status(201).json({ employee: result.rows[0] });
  })
);

router.patch(
  "/:id",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const id = readId(req);
    const changes = readEmployee(req.body, { partial: true });

    // Column names come from readEmployee's fixed allow-list, never the client.
    const fields = Object.keys(changes);
    const assignments = fields.map((field, index) => `${field} = $${index + 3}`);

    const result = await pool
      .query(
        `UPDATE attendance.employees
         SET ${assignments.join(", ")}, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING ${COLUMNS}`,
        [id, req.user.organization_id, ...fields.map((field) => changes[field])]
      )
      .catch(failOnDuplicate);

    if (!result.rows[0]) {
      fail(404, "Employee not found.");
    }

    res.json({ employee: result.rows[0] });
  })
);

module.exports = router;
