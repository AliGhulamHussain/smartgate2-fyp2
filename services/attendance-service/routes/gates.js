const express = require("express");
const { pool } = require("../db");
const {
  authenticate,
  requireOrganization,
  allowRoles,
} = require("../middleware/auth");
const { asyncHandler, fail, validUuid, readGate } = require("../utils");

const router = express.Router();

router.use(authenticate, requireOrganization);

const COLUMNS = "id, organization_id, name, direction, status, created_at";

// Turns a duplicate gate name into a safe 409.
function failOnDuplicate(error) {
  if (error.code === "23505") {
    fail(409, "A gate with this name already exists.");
  }
  throw error;
}

function readId(req) {
  if (!validUuid(req.params.id)) {
    fail(400, "Gate id must be a valid UUID.");
  }
  return req.params.id;
}

// ponytail: no pagination, an organization has only a handful of gates;
// add page/limit like employees if that stops being true.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, direction } = req.query;

    if (status !== undefined && !["active", "inactive"].includes(status)) {
      fail(400, "status must be active or inactive.");
    }
    if (direction !== undefined && !["entry", "exit", "both"].includes(direction)) {
      fail(400, "direction must be entry, exit or both.");
    }

    // Every query starts with the caller's organization.
    const conditions = ["organization_id = $1"];
    const values = [req.user.organization_id];

    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
    if (direction) {
      values.push(direction);
      conditions.push(`direction = $${values.length}`);
    }

    const result = await pool.query(
      `SELECT ${COLUMNS}
       FROM attendance.gates
       WHERE ${conditions.join(" AND ")}
       ORDER BY name`,
      values
    );

    res.json({ gates: result.rows });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = readId(req);

    const result = await pool.query(
      `SELECT ${COLUMNS}
       FROM attendance.gates
       WHERE id = $1 AND organization_id = $2`,
      [id, req.user.organization_id]
    );

    if (!result.rows[0]) {
      fail(404, "Gate not found.");
    }

    res.json({ gate: result.rows[0] });
  })
);

router.post(
  "/",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const gate = readGate(req.body);

    // COALESCE keeps the database default direction ('both') when omitted.
    const result = await pool
      .query(
        `INSERT INTO attendance.gates (organization_id, name, direction)
         VALUES ($1, $2, COALESCE($3, 'both'))
         RETURNING ${COLUMNS}`,
        [req.user.organization_id, gate.name, gate.direction ?? null]
      )
      .catch(failOnDuplicate);

    res.status(201).json({ gate: result.rows[0] });
  })
);

router.patch(
  "/:id",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const id = readId(req);
    const changes = readGate(req.body, { partial: true });

    // Column names come from readGate's fixed allow-list, never the client.
    const fields = Object.keys(changes);
    const assignments = fields.map((field, index) => `${field} = $${index + 3}`);

    const result = await pool
      .query(
        `UPDATE attendance.gates
         SET ${assignments.join(", ")}
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

module.exports = router;
