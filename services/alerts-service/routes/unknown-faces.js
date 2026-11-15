// Unknown-face alerts. The photos show strangers, so viewers cannot see
// them. Admins, managers and gate operators can look; only admins and
// managers can review (mark as reviewed or dismissed).
const path = require("path");
const express = require("express");
const { pool, transaction, audit } = require("../db");
const { authenticate, allowRoles } = require("../auth");
const {
  asyncHandler,
  fail,
  isUuid,
  isObject,
  readPositiveInt,
  readChoice,
} = require("../helpers");
const { SNAPSHOT_DIR } = require("../consumer");

const router = express.Router();
router.use(authenticate, allowRoles("org_admin", "manager", "gate_operator"));

const STATUSES = ["new", "reviewed", "dismissed"];
const COLUMNS = `id, organization_id, gate_id, best_distance, status,
                 reviewed_by, reviewed_at, note, captured_at`;

// Review body: { status, note? }
function readReview(body) {
  if (!isObject(body) || Object.keys(body).some((key) => !["status", "note"].includes(key))) {
    fail(400, "Body must be { status, note? }.");
  }

  if (!STATUSES.includes(body.status)) {
    fail(400, "status must be new, reviewed or dismissed.");
  }

  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string" || body.note.trim().length > 500) {
      fail(400, "note must be text of at most 500 characters.");
    }
    note = body.note.trim() || null;
  }

  return { status: body.status, note };
}

// The client gets a URL for the photo, never the file path on disk.
function withSnapshotUrl(row) {
  return { ...row, snapshot_url: `/api/alerts/unknown-faces/${row.id}/snapshot` };
}

function readId(req) {
  if (!isUuid(req.params.id)) {
    fail(400, "Alert id must be a valid UUID.");
  }
  return req.params.id;
}

// Loads one alert of the caller's organization, or answers 404.
async function findAlert(req, columns = COLUMNS) {
  const result = await pool.query(
    `SELECT ${columns} FROM alerts.unknown_faces
     WHERE id = $1 AND organization_id = $2`,
    [readId(req), req.user.organization_id]
  );

  if (!result.rows[0]) {
    fail(404, "Alert not found.");
  }
  return result.rows[0];
}

// GET /api/alerts/unknown-faces?status=&gate_id=&page=&limit=   (newest first)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = readPositiveInt(req.query.page, "page", 1, 100000);
    const limit = readPositiveInt(req.query.limit, "limit", 20, 100);
    const status = readChoice(req.query.status, "status", STATUSES);
    const gateId = req.query.gate_id;

    if (gateId !== undefined && !isUuid(gateId)) {
      fail(400, "gate_id must be a valid UUID.");
    }

    const where = ["organization_id = $1"];
    const values = [req.user.organization_id];

    if (status) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }
    if (gateId) {
      values.push(gateId);
      where.push(`gate_id = $${values.length}`);
    }

    // COUNT(*) OVER () gives the total number of matching rows on every row.
    const list = await pool.query(
      `SELECT ${COLUMNS}, COUNT(*) OVER ()::int AS total_rows
       FROM alerts.unknown_faces
       WHERE ${where.join(" AND ")}
       ORDER BY captured_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit]
    );

    // Badge numbers for the dashboard (ignore the filters).
    const counts = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'new')::int AS new,
              COUNT(*) FILTER (WHERE status = 'reviewed')::int AS reviewed,
              COUNT(*) FILTER (WHERE status = 'dismissed')::int AS dismissed
       FROM alerts.unknown_faces
       WHERE organization_id = $1`,
      [req.user.organization_id]
    );

    res.json({
      unknown_faces: list.rows.map(({ total_rows, ...row }) => withSnapshotUrl(row)),
      counts: counts.rows[0],
      page,
      limit,
      total: list.rows[0]?.total_rows ?? 0,
    });
  })
);

// GET /api/alerts/unknown-faces/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json({ unknown_face: withSnapshotUrl(await findAlert(req)) });
  })
);

// GET /api/alerts/unknown-faces/:id/snapshot: the JPEG itself.
// The browser fetches it with the token and shows it with URL.createObjectURL().
router.get(
  "/:id/snapshot",
  asyncHandler(async (req, res) => {
    const { snapshot_path: snapshotPath } = await findAlert(req, "snapshot_path");
    const file = path.resolve(SNAPSHOT_DIR, snapshotPath);

    // Never send a file from outside the snapshots folder.
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

// PATCH /api/alerts/unknown-faces/:id   { status, note? }   (admins and managers)
// Saves who reviewed it and when. Setting it back to "new" clears that.
router.patch(
  "/:id",
  allowRoles("org_admin", "manager"),
  asyncHandler(async (req, res) => {
    const id = readId(req);
    const review = readReview(req.body);

    const alert = await transaction(async (db) => {
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

    res.json({ unknown_face: withSnapshotUrl(alert) });
  })
);

module.exports = { router, readReview };
