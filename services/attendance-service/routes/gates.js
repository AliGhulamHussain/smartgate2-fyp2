// Gates: the doors where a kiosk camera stands.
// direction: "entry" (always check in), "exit" (always check out) or
// "both" (check in or out depending on whether the person is inside).
// Gates are never deleted, only set to "inactive", because attendance
// logs point to them.
const express = require("express");
const { pool } = require("../db");
const { authenticate, allowRoles } = require("../auth");
const { asyncHandler, fail, checkBody, readUuid } = require("../helpers");

const router = express.Router();
router.use(authenticate);

const COLUMNS = "id, organization_id, name, direction, status, created_at";
const DIRECTIONS = ["entry", "exit", "both"];
const STATUSES = ["active", "inactive"];

// Checks a gate body. For updates (partial = true) every field is optional
// and "status" may also be changed.
function readGate(body, { partial = false } = {}) {
  const allowed = partial ? ["name", "direction", "status"] : ["name", "direction"];
  checkBody(body, allowed, { partial });

  const gate = {};

  if ("name" in body || !partial) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "" || name.length > 80) {
      fail(400, "name is required and must be at most 80 characters.");
    }
    gate.name = name;
  }

  if ("direction" in body) {
    if (!DIRECTIONS.includes(body.direction)) {
      fail(400, "direction must be entry, exit or both.");
    }
    gate.direction = body.direction;
  }

  if ("status" in body) {
    if (!STATUSES.includes(body.status)) {
      fail(400, "status must be active or inactive.");
    }
    gate.status = body.status;
  }

  return gate;
}

// PostgreSQL error 23505 means a UNIQUE rule was broken.
function failOnDuplicate(error) {
  if (error.code === "23505") {
    fail(409, "A gate with this name already exists.");
  }
  throw error;
}

// GET /api/attendance/gates?status=&direction=
// ponytail: no pagination, an organization has only a handful of gates;
// add page/limit like employees if that stops being true.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, direction } = req.query;

    if (status !== undefined && !STATUSES.includes(status)) {
      fail(400, "status must be active or inactive.");
    }
    if (direction !== undefined && !DIRECTIONS.includes(direction)) {
      fail(400, "direction must be entry, exit or both.");
    }

    const where = ["organization_id = $1"];
    const values = [req.user.organization_id];

    if (status) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }
    if (direction) {
      values.push(direction);
      where.push(`direction = $${values.length}`);
    }

    const result = await pool.query(
      `SELECT ${COLUMNS} FROM attendance.gates
       WHERE ${where.join(" AND ")}
       ORDER BY name`,
      values
    );

    res.json({ gates: result.rows });
  })
);

// GET /api/attendance/gates/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = readUuid(req.params.id, "Gate id");

    const result = await pool.query(
      `SELECT ${COLUMNS} FROM attendance.gates
       WHERE id = $1 AND organization_id = $2`,
      [id, req.user.organization_id]
    );

    if (!result.rows[0]) {
      fail(404, "Gate not found.");
    }

    res.json({ gate: result.rows[0] });
  })
);

// POST /api/attendance/gates (admins only). Direction defaults to "both".
router.post(
  "/",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const gate = readGate(req.body);

    const result = await pool
      .query(
        `INSERT INTO attendance.gates (organization_id, name, direction)
         VALUES ($1, $2, $3)
         RETURNING ${COLUMNS}`,
        [req.user.organization_id, gate.name, gate.direction ?? "both"]
      )
      .catch(failOnDuplicate);

    res.status(201).json({ gate: result.rows[0] });
  })
);

// PATCH /api/attendance/gates/:id (admins only). Only the sent fields change.
router.patch(
  "/:id",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const id = readUuid(req.params.id, "Gate id");
    const changes = readGate(req.body, { partial: true });

    // Column names come from readGate's fixed list, never from the client.
    const fields = Object.keys(changes);
    const setSql = fields.map((field, i) => `${field} = $${i + 3}`).join(", ");

    const result = await pool
      .query(
        `UPDATE attendance.gates
         SET ${setSql}
         WHERE id = $1 AND organization_id = $2
         RETURNING ${COLUMNS}`,
        [id, req.user.organization_id, ...fields.map((field) => changes[field])]
      )
      .catch(failOnDuplicate);

    if (!result.rows[0]) {
      fail(404, "Gate not found.");
    }

    res.json({ gate: result.rows[0] });
  })
);

module.exports = { router, readGate };
