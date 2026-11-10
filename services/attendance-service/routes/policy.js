const express = require("express");
const { pool } = require("../db");
const {
  authenticate,
  requireOrganization,
  allowRoles,
} = require("../middleware/auth");
const { asyncHandler, fail, readPolicy } = require("../utils");

const router = express.Router();

router.use(authenticate, requireOrganization);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT organization_id, timezone, work_start, work_end,
              grace_minutes, working_days, auto_close_time, updated_at
       FROM attendance.org_policies
       WHERE organization_id = $1`,
      [req.user.organization_id]
    );

    if (!result.rows[0]) {
      fail(404, "Attendance policy is not configured.");
    }

    res.json({ policy: result.rows[0] });
  })
);

router.put(
  "/",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const policy = readPolicy(req.body);

    const result = await pool.query(
      `INSERT INTO attendance.org_policies
         (organization_id, timezone, work_start, work_end,
          grace_minutes, working_days, auto_close_time, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (organization_id)
       DO UPDATE SET
         timezone = EXCLUDED.timezone,
         work_start = EXCLUDED.work_start,
         work_end = EXCLUDED.work_end,
         grace_minutes = EXCLUDED.grace_minutes,
         working_days = EXCLUDED.working_days,
         auto_close_time = EXCLUDED.auto_close_time,
         updated_at = NOW()
       RETURNING organization_id, timezone, work_start, work_end,
                 grace_minutes, working_days, auto_close_time, updated_at`,
      [
        req.user.organization_id,
        policy.timezone,
        policy.work_start,
        policy.work_end,
        policy.grace_minutes,
        policy.working_days,
        policy.auto_close_time,
      ]
    );

    res.json({ policy: result.rows[0] });
  })
);

module.exports = router;
