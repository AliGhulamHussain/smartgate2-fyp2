// The attendance policy: working hours, grace minutes, working days and
// timezone. Each organization has exactly one policy.
const express = require("express");
const { pool } = require("../db");
const { authenticate, allowRoles } = require("../auth");
const { asyncHandler, fail, isObject } = require("../helpers");

const router = express.Router();
router.use(authenticate);

const POLICY_FIELDS = [
  "timezone",
  "work_start",
  "work_end",
  "grace_minutes",
  "working_days",
  "auto_close_time",
];

// "09:00" or "09:00:00" -> "09:00:00"
function readTime(value, name) {
  const match =
    typeof value === "string" &&
    value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);

  if (!match) {
    fail(400, `${name} must use HH:MM or HH:MM:SS format.`);
  }
  return `${match[1]}:${match[2]}:${match[3] || "00"}`;
}

// A timezone name like "Asia/Karachi". Intl throws for unknown names.
function readTimezone(value) {
  if (typeof value !== "string" || value.length > 50) {
    fail(400, "timezone must be a valid IANA timezone.");
  }

  const timezone = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    fail(400, "timezone must be a valid IANA timezone.");
  }
  return timezone;
}

// ISO weekdays: 1 = Monday ... 7 = Sunday. Returned sorted.
function readWorkingDays(value) {
  const valid =
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 7 &&
    value.every((day) => Number.isSafeInteger(day) && day >= 1 && day <= 7) &&
    new Set(value).size === value.length;

  if (!valid) {
    fail(400, "working_days must contain unique ISO weekdays from 1 to 7.");
  }
  return [...value].sort((a, b) => a - b);
}

// All six fields must be sent, and nothing else.
function readPolicy(body) {
  const keys = isObject(body) ? Object.keys(body) : [];

  if (
    keys.length !== POLICY_FIELDS.length ||
    !POLICY_FIELDS.every((field) => keys.includes(field))
  ) {
    fail(400, "Provide all supported attendance policy fields.");
  }

  const grace = body.grace_minutes;
  if (!Number.isSafeInteger(grace) || grace < 0 || grace > 1440) {
    fail(400, "grace_minutes must be an integer from 0 to 1440.");
  }

  const policy = {
    timezone: readTimezone(body.timezone),
    work_start: readTime(body.work_start, "work_start"),
    work_end: readTime(body.work_end, "work_end"),
    grace_minutes: grace,
    working_days: readWorkingDays(body.working_days),
    auto_close_time: readTime(body.auto_close_time, "auto_close_time"),
  };

  if (policy.work_start === policy.work_end) {
    fail(400, "work_start and work_end must be different.");
  }

  return policy;
}

const COLUMNS = `organization_id, timezone, work_start, work_end,
                 grace_minutes, working_days, auto_close_time, updated_at`;

// GET /api/attendance/policy
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM attendance.org_policies WHERE organization_id = $1`,
      [req.user.organization_id]
    );

    if (!result.rows[0]) {
      fail(404, "Attendance policy is not configured.");
    }

    res.json({ policy: result.rows[0] });
  })
);

// PUT /api/attendance/policy (admins only). Creates the policy the first
// time, and updates it after that.
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
       ON CONFLICT (organization_id) DO UPDATE SET
         timezone = EXCLUDED.timezone,
         work_start = EXCLUDED.work_start,
         work_end = EXCLUDED.work_end,
         grace_minutes = EXCLUDED.grace_minutes,
         working_days = EXCLUDED.working_days,
         auto_close_time = EXCLUDED.auto_close_time,
         updated_at = NOW()
       RETURNING ${COLUMNS}`,
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

module.exports = { router, readPolicy };
