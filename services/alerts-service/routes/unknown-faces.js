// Unknown-face alerts. Snapshots are photos of strangers, so viewers cannot
// see them; admins and managers review, gate operators can look.
const path = require("path");
const express = require("express");
const { pool, transaction, audit } = require("../db");
const {
  authenticate,
  requireOrganization,
  allowRoles,
} = require("../middleware/auth");
const {
  asyncHandler,
  fail,
  validUuid,
  readPositiveInt,
  readChoice,
  readReview,
} = require("../utils");
const { SNAPSHOT_DIR } = require("../consumer");

const router = express.Router();

router.use(
  authenticate,
  requireOrganization,
  allowRoles("org_admin", "manager", "gate_operator")
);

const COLUMNS = `id, organization_id, gate_id, best_distance, status,
                 reviewed_by, reviewed_at, note, captured_at`;

// Clients get a URL for the snapshot, never the file path on disk.
function present(row) {
  return { ...row, snapshot_url: `/api/alerts/unknown-faces/${row.id}/snapshot` };
}

function readId(req) {
  if (!validUuid(req.params.id)) {
    fail(400, "Alert id must be a valid UUID.");
  }
  return req.params.id;
}

async function findAlert(req, columns = COLUMNS) {
  const result = await pool.query(
    `SELECT ${columns}
     FROM alerts.unknown_faces
     WHERE id = $1 AND organization_id = $2`,
    [readId(req), req.user.organization_id]
  );

  if (!result.rows[0]) {
    fail(404, "Alert not found.");
  }
  return result.rows[0];
}

// GET /api/alerts/unknown-faces?status=&gate_id=&page=&limit=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = readPositiveInt(req.query.page, "page", 1, 100000);
    const limit = readPositiveInt(req.query.limit, "limit", 20, 100);
    const status = readChoice(req.query.status, "status", ["new", "reviewed", "dismissed"]);
    const gateId = req.query.gate_id;

    if (gateId !== undefined && !validUuid(gateId)) {
      fail(400, "gate_id must be a valid UUID.");
    }

    const conditions = ["organization_id = $1"];
    const values = [req.user.organization_id];

    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
    if (gateId) {
      values.push(gateId);
      conditions.push(`gate_id = $${values.length}`);
    }

    const where = conditions.join(" AND ");

    const list = await pool.query(
      `SELECT ${COLUMNS}, COUNT(*) OVER ()::int AS total_rows
       FROM alerts.unknown_faces
       WHERE ${where}
       ORDER BY captured_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit]
    );

    // Badge counts for the dashboard, independent of the filters.
    const counts = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'new')::int AS new,
              COUNT(*) FILTER (WHERE status = 'reviewed')::int AS reviewed,
              COUNT(*) FILTER (WHERE status = 'dismissed')::int AS dismissed
       FROM alerts.unknown_faces
       WHERE organization_id = $1`,
      [req.user.organization_id]
    );

    res.json({
      unknown_faces: list.rows.map(({ total_rows, ...row }) => present(row)),
      counts: counts.rows[0],
      page,
      limit,
      total: list.rows[0]?.total_rows ?? 0,
    });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json({ unknown_face: present(await findAlert(req)) });
  })
);

// The image itself. Frontends fetch it with the bearer token and show it
// through URL.createObjectURL().
router.get(
  "/:id/snapshot",
  asyncHandler(async (req, res) => {
    const { snapshot_path: snapshotPath } = await findAlert(req, "snapshot_path");
    const file = path.resolve(SNAPSHOT_DIR, snapshotPath);

    if (!file.startsWith(SNAPSHOT_DIR + path.sep)) {
      fail(404, "Snapshot not found.");
    }

    res.type("image/jpeg");
    res.sendFile(file, (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ message: "Snapshot not found." });
      }
    });
  })
);

// PATCH /api/alerts/unknown-faces/:id { status, note? }
router.patch(
  "/:id",
  allowRoles("org_admin", "manager"),
  asyncHandler(async (req, res) => {
    const id = readId(req);
    const review = readReview(req.body);

    const alert = await transaction(async (db) => {
      // Setting status back to "new" clears the reviewer.
      const result = await db.query(
        `UPDATE alerts.unknown_faces
         SET status = $3::text,
             note = $4,
             reviewed_by = CASE WHEN $3::text = 'new' THEN NULL ELSE $5::uuid END,
             reviewed_at = CASE WHEN $3::text = 'new' THEN NULL ELSE NOW() END
         WHERE id = $1 AND organization_id = $2
         RETURNING ${COLUMNS}`,
        [id, req.user.organization_id, review.status, review.note, req.user.id]
      );

      if (!result.rows[0]) {
        fail(404, "Alert not found.");
      }

      await audit(db, req, `unknown_face.${review.status}`, "unknown_face", id,
        review.note ? { note: review.note } : null);

      return result.rows[0];
    });

    res.json({ unknown_face: present(alert) });
  })
);

module.exports = router;
