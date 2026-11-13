// Read-only history: notification log and audit log. Admin only.
const express = require("express");
const { pool } = require("../db");
const {
  authenticate,
  requireOrganization,
  allowRoles,
} = require("../middleware/auth");
const { asyncHandler, readPositiveInt, readChoice } = require("../utils");

const router = express.Router();

router.use(authenticate, requireOrganization, allowRoles("org_admin"));

// Pages through one organization-scoped table, newest first.
async function page(req, sql, extraCondition, extraValue) {
  const pageNumber = readPositiveInt(req.query.page, "page", 1, 100000);
  const limit = readPositiveInt(req.query.limit, "limit", 50, 200);
  const values = [req.user.organization_id];
  let where = "organization_id = $1";

  if (extraValue !== undefined) {
    values.push(extraValue);
    where += ` AND ${extraCondition} = $2`;
  }

  const result = await pool.query(
    `${sql.replace("{where}", where)}
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, (pageNumber - 1) * limit]
  );

  return {
    rows: result.rows.map(({ total_rows, ...row }) => row),
    page: pageNumber,
    limit,
    total: result.rows[0]?.total_rows ?? 0,
  };
}

// GET /api/alerts/notifications?status=queued|sent|failed
router.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const status = readChoice(req.query.status, "status", ["queued", "sent", "failed"]);
    const { rows, ...paging } = await page(
      req,
      `SELECT id, type, recipient, subject, payload, status, error, created_at, sent_at,
              COUNT(*) OVER ()::int AS total_rows
       FROM alerts.notifications
       WHERE {where}
       ORDER BY created_at DESC`,
      "status",
      status
    );

    res.json({ notifications: rows, ...paging });
  })
);

// GET /api/alerts/audit-logs
router.get(
  "/audit-logs",
  asyncHandler(async (req, res) => {
    const { rows, ...paging } = await page(
      req,
      `SELECT id, actor_user_id, action, entity_type, entity_id, details, created_at,
              COUNT(*) OVER ()::int AS total_rows
       FROM alerts.audit_logs
       WHERE {where}
       ORDER BY created_at DESC`
    );

    res.json({ audit_logs: rows, ...paging });
  })
);

module.exports = router;
