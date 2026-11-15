// Employees: the people whose attendance is tracked.
// Everyone in the organization can read; only admins can add or edit.
// Employees are never deleted, only set to "inactive", because their
// attendance history still points to them.
const express = require("express");
const { pool } = require("../db");
const { authenticate, allowRoles } = require("../auth");
const {
  asyncHandler,
  fail,
  checkBody,
  readText,
  readPositiveInt,
  readUuid,
} = require("../helpers");

const router = express.Router();
router.use(authenticate);

const COLUMNS = `id, organization_id, employee_code, full_name, email, phone,
                 department, designation, status, presence, face_enrolled,
                 created_at, updated_at`;

// Text fields and their maximum length. The first two are required.
const TEXT_FIELDS = {
  employee_code: 50,
  full_name: 100,
  email: 150,
  phone: 20,
  department: 100,
  designation: 100,
};
const REQUIRED = ["employee_code", "full_name"];

// Checks an employee body. For updates (partial = true) every field is
// optional and "status" may also be changed. "presence" and "face_enrolled"
// are never accepted: punches and face enrollment set those.
function readEmployee(body, { partial = false } = {}) {
  const allowed = Object.keys(TEXT_FIELDS);
  if (partial) allowed.push("status");

  checkBody(body, allowed, { partial });

  const employee = {};

  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    const required = REQUIRED.includes(field);

    if (!(field in body)) {
      if (required && !partial) fail(400, `${field} is required.`);
      continue;
    }

    let value = body[field];

    // Optional fields can be cleared with null.
    if (value === null && !required) {
      employee[field] = null;
      continue;
    }
    if (typeof value !== "string") {
      fail(400, `${field} must be a string.`);
    }

    value = value.trim();

    if (value === "") {
      if (required) fail(400, `${field} cannot be empty.`);
      employee[field] = null;
      continue;
    }
    if (value.length > max) {
      fail(400, `${field} must be at most ${max} characters.`);
    }

    employee[field] = value;
  }

  if (employee.employee_code && !/^[A-Za-z0-9._-]+$/.test(employee.employee_code)) {
    fail(400, "employee_code may contain only letters, digits, '.', '_' and '-'.");
  }

  if (employee.email) {
    employee.email = employee.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email)) {
      fail(400, "email must be a valid email address.");
    }
  }

  if (employee.phone && !/^\+?[0-9][0-9 -]{5,18}$/.test(employee.phone)) {
    fail(400, "phone must contain 6-20 digits, spaces or dashes, optionally starting with +.");
  }

  if ("status" in body) {
    if (!["active", "inactive"].includes(body.status)) {
      fail(400, "status must be active or inactive.");
    }
    employee.status = body.status;
  }

  return employee;
}

// PostgreSQL error 23505 means a UNIQUE rule was broken.
function failOnDuplicate(error) {
  if (error.code === "23505") {
    fail(409, "An employee with this employee_code already exists.");
  }
  throw error;
}

// GET /api/attendance/employees?search=&department=&status=&presence=&page=&limit=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = readPositiveInt(req.query.page, "page", 1, 100000);
    const limit = readPositiveInt(req.query.limit, "limit", 20, 100);
    const search = readText(req.query.search, "search", 100);
    const department = readText(req.query.department, "department", 100);
    const status = readText(req.query.status, "status", 10);
    const presence = readText(req.query.presence, "presence", 10);

    if (status && !["active", "inactive"].includes(status)) {
      fail(400, "status must be active or inactive.");
    }
    if (presence && !["inside", "outside"].includes(presence)) {
      fail(400, "presence must be inside or outside.");
    }

    // Build the WHERE part. It always starts with the caller's organization.
    const where = ["organization_id = $1"];
    const values = [req.user.organization_id];

    if (search) {
      // Escape % and _ so they are searched for literally.
      values.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      where.push(`(full_name ILIKE $${values.length} OR employee_code ILIKE $${values.length})`);
    }
    if (department) {
      values.push(department);
      where.push(`LOWER(department) = LOWER($${values.length})`);
    }
    if (status) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }
    if (presence) {
      values.push(presence);
      where.push(`presence = $${values.length}`);
    }

    const whereSql = where.join(" AND ");

    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM attendance.employees WHERE ${whereSql}`,
      values
    );

    const list = await pool.query(
      `SELECT ${COLUMNS}
       FROM attendance.employees
       WHERE ${whereSql}
       ORDER BY full_name, employee_code
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit]
    );

    res.json({ employees: list.rows, page, limit, total: count.rows[0].total });
  })
);

// GET /api/attendance/employees/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = readUuid(req.params.id, "Employee id");

    const result = await pool.query(
      `SELECT ${COLUMNS} FROM attendance.employees
       WHERE id = $1 AND organization_id = $2`,
      [id, req.user.organization_id]
    );

    if (!result.rows[0]) {
      fail(404, "Employee not found.");
    }

    res.json({ employee: result.rows[0] });
  })
);

// POST /api/attendance/employees (admins only)
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

// PATCH /api/attendance/employees/:id (admins only). Only the sent fields change.
router.patch(
  "/:id",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const id = readUuid(req.params.id, "Employee id");
    const changes = readEmployee(req.body, { partial: true });

    // e.g. "full_name = $3, email = $4". The column names come from
    // readEmployee's fixed list, never straight from the client.
    const fields = Object.keys(changes);
    const setSql = fields.map((field, i) => `${field} = $${i + 3}`).join(", ");

    const result = await pool
      .query(
        `UPDATE attendance.employees
         SET ${setSql}, updated_at = NOW()
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

module.exports = { router, readEmployee };
