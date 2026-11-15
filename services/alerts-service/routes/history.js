// Read-only history for admins: the notification log and the audit log.
// Both are paged and newest first.
const express = require("express");
const { pool } = require("../db");
const { authenticate, allowRoles } = require("../auth");
const { asyncHandler, readPositiveInt, readChoice } = require("../helpers");

const router = express.Router();
router.use(authenticate, allowRoles("org_admin"));

function readPaging(req) {
  const page = readPositiveInt(req.query.page, "page", 1, 100000);
  const limit = readPositiveInt(req.query.limit, "limit", 50, 200);
  return { page, limit, offset: (page - 1) * limit };
}

// GET /api/alerts/notifications?status=queued|sent|failed&page=&limit=
router.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const status = readChoice(req.query.status, "status", ["queued", "sent", "failed"]);
    const { page, limit, offset } = readPaging(req);

    // $2 is the optional status filter; NULL means "any status".
    const result = await pool.query(
      `SELECT id, type, recipient, subject, payload, status, error, created_at, sent_at,
              COUNT(*) OVER ()::int AS total_rows
       FROM alerts.notifications
       WHERE organization_id = $1 AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.user.organization_id, status ?? null, limit, offset]
    );

    res.json({
      notifications: result.rows.map(({ total_rows, ...row }) => row),
      page,
      limit,
      total: result.rows[0]?.total_rows ?? 0,
    });
  })
);

// GET /api/alerts/audit-logs?page=&limit=
router.get(
  "/audit-logs",
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = readPaging(req);

    const result = await pool.query(
      `SELECT id, actor_user_id, action, entity_type, entity_id, details, created_at,
              COUNT(*) OVER ()::int AS total_rows
       FROM alerts.audit_logs
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.organization_id, limit, offset]
    );

    res.json({
      audit_logs: result.rows.map(({ total_rows, ...row }) => row),
      page,
      limit,
      total: result.rows[0]?.total_rows ?? 0,
    });
  })
);

module.exports = { router };
