// Read-only attendance monitoring for the dashboard. All organization roles
// may read; every query is scoped to the caller's organization.
const express = require("express");
const { pool } = require("../db");
const { authenticate, requireOrganization } = require("../middleware/auth");
const {
  asyncHandler,
  fail,
  readQueryText,
  readPositiveInt,
  readDate,
  readChoice,
  readQueryUuid,
} = require("../utils");

const router = express.Router();

router.use(authenticate, requireOrganization);

const DAY_STATUSES = ["present", "late", "absent", "holiday", "weekend", "incomplete"];

// Loads the policy plus "today" in the organization's timezone.
async function loadPolicy(organizationId) {
  const result = await pool.query(
    `SELECT timezone, working_days,
            (NOW() AT TIME ZONE timezone)::date::text AS today
     FROM attendance.org_policies
     WHERE organization_id = $1`,
    [organizationId]
  );

  if (!result.rows[0]) {
    fail(409, "Attendance policy is not configured.");
  }

  return result.rows[0];
}

// GET /api/attendance/presence: who is inside right now.
// ponytail: no pagination, fine for hundreds inside; add page/limit for thousands.
router.get(
  "/presence",
  asyncHandler(async (req, res) => {
    const organizationId = req.user.organization_id;

    const inside = await pool.query(
      `SELECT e.id, e.employee_code, e.full_name, e.department, e.designation,
              last_log.logged_at AS checked_in_at,
              g.id AS gate_id, g.name AS gate_name
       FROM attendance.employees e
       LEFT JOIN LATERAL (
         SELECT l.logged_at, l.gate_id
         FROM attendance.attendance_logs l
         WHERE l.employee_id = e.id
         ORDER BY l.logged_at DESC
         LIMIT 1
       ) last_log ON true
       LEFT JOIN attendance.gates g ON g.id = last_log.gate_id
       WHERE e.organization_id = $1 AND e.presence = 'inside'
       ORDER BY last_log.logged_at DESC`,
      [organizationId]
    );

    const counts = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_employees,
              COUNT(*) FILTER (WHERE presence = 'inside')::int AS inside
       FROM attendance.employees
       WHERE organization_id = $1`,
      [organizationId]
    );

    res.json({ ...counts.rows[0], employees: inside.rows });
  })
);

// GET /api/attendance/logs: raw check-in/check-out history.
// from/to are inclusive dates in the organization's timezone.
router.get(
  "/logs",
  asyncHandler(async (req, res) => {
    const page = readPositiveInt(req.query.page, "page", 1, 100000);
    const limit = readPositiveInt(req.query.limit, "limit", 50, 200);
    const from = readDate(req.query.from, "from");
    const to = readDate(req.query.to, "to");
    const employeeId = readQueryUuid(req.query.employee_id, "employee_id");
    const gateId = readQueryUuid(req.query.gate_id, "gate_id");
    const action = readChoice(req.query.action, "action", ["check_in", "check_out"]);
    const status = readChoice(req.query.status, "status", [
      "on_time",
      "late",
      "normal",
      "early_leave",
    ]);

    if (from && to && from > to) {
      fail(400, "from must be on or before to.");
    }

    const policy = await loadPolicy(req.user.organization_id);

    const conditions = ["l.organization_id = $1"];
    const values = [req.user.organization_id];
    const add = (sql, value) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (from) {
      values.push(policy.timezone);
      add(`l.logged_at >= (?::date::timestamp AT TIME ZONE $${values.length})`, from);
    }
    if (to) {
      values.push(policy.timezone);
      add(`l.logged_at < ((?::date + 1)::timestamp AT TIME ZONE $${values.length})`, to);
    }
    if (employeeId) add("l.employee_id = ?", employeeId);
    if (gateId) add("l.gate_id = ?", gateId);
    if (action) add("l.action = ?", action);
    if (status) add("l.status = ?", status);

    const where = conditions.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM attendance.attendance_logs l WHERE ${where}`,
      values
    );

    const listResult = await pool.query(
      `SELECT l.id, l.employee_id, e.employee_code, e.full_name,
              l.gate_id, g.name AS gate_name, l.action, l.status,
              l.late_by_minutes, l.confidence, l.source, l.logged_at
       FROM attendance.attendance_logs l
       JOIN attendance.employees e ON e.id = l.employee_id
       LEFT JOIN attendance.gates g ON g.id = l.gate_id
       WHERE ${where}
       ORDER BY l.logged_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit]
    );

    res.json({
      logs: listResult.rows,
      page,
      limit,
      total: countResult.rows[0].total,
    });
  })
);

// GET /api/attendance/daily: one row per employee for a date (default today).
// Employees without a summary row are "absent" on working days, otherwise
// "weekend" or "holiday". Employees created after the date are left out,
// and inactive employees appear only if they have a row that day.
router.get(
  "/daily",
  asyncHandler(async (req, res) => {
    const page = readPositiveInt(req.query.page, "page", 1, 100000);
    const limit = readPositiveInt(req.query.limit, "limit", 50, 200);
    const department = readQueryText(req.query.department, "department", 100);
    const dayStatus = readChoice(req.query.status, "status", DAY_STATUSES);
    const organizationId = req.user.organization_id;

    const policy = await loadPolicy(organizationId);
    const date = readDate(req.query.date, "date") ?? policy.today;

    if (date > policy.today) {
      fail(400, "date cannot be in the future.");
    }

    const holiday = await pool.query(
      `SELECT name FROM attendance.holidays
       WHERE organization_id = $1 AND holiday_date = $2`,
      [organizationId, date]
    );
    const isoWeekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

    let dayType = "working";
    if (holiday.rows[0]) dayType = "holiday";
    else if (!policy.working_days.includes(isoWeekday)) dayType = "weekend";

    const missingStatus = dayType === "working" ? "absent" : dayType;

    const values = [organizationId, date, missingStatus, policy.timezone];
    let departmentFilter = "";

    if (department) {
      values.push(department);
      departmentFilter = `AND LOWER(e.department) = LOWER($${values.length})`;
    }

    const records = `
      SELECT e.id AS employee_id, e.employee_code, e.full_name, e.department,
             e.status AS employee_status,
             da.first_check_in, da.last_check_out,
             COALESCE(da.total_minutes, 0) AS total_minutes,
             COALESCE(da.late_by_minutes, 0) AS late_by_minutes,
             COALESCE(da.day_status, $3) AS day_status
      FROM attendance.employees e
      LEFT JOIN attendance.daily_attendance da
        ON da.employee_id = e.id AND da.work_date = $2
      WHERE e.organization_id = $1
        AND (da.id IS NOT NULL
             OR (e.status = 'active'
                 AND (e.created_at AT TIME ZONE $4)::date <= $2::date))
        ${departmentFilter}`;

    const summaryResult = await pool.query(
      `SELECT day_status, COUNT(*)::int AS count
       FROM (${records}) r
       GROUP BY day_status`,
      values
    );

    const summary = Object.fromEntries(DAY_STATUSES.map((s) => [s, 0]));
    let totalEmployees = 0;
    for (const row of summaryResult.rows) {
      summary[row.day_status] = row.count;
      totalEmployees += row.count;
    }

    const listValues = [...values];
    let statusFilter = "";
    if (dayStatus) {
      listValues.push(dayStatus);
      statusFilter = `WHERE day_status = $${listValues.length}`;
    }

    const listResult = await pool.query(
      `SELECT *, COUNT(*) OVER ()::int AS total_rows
       FROM (${records}) r
       ${statusFilter}
       ORDER BY full_name, employee_code
       LIMIT $${listValues.length + 1} OFFSET $${listValues.length + 2}`,
      [...listValues, limit, (page - 1) * limit]
    );

    res.json({
      date,
      day_type: dayType,
      holiday_name: holiday.rows[0]?.name ?? null,
      summary: { total_employees: totalEmployees, ...summary },
      records: listResult.rows.map(({ total_rows, ...row }) => row),
      page,
      limit,
      total: dayStatus ? (listResult.rows[0]?.total_rows ?? 0) : totalEmployees,
    });
  })
);

// GET /api/attendance/stats: dashboard numbers for today plus a 7-day trend.
// Absent uses the same rule as /daily: active employees created by that day
// with no summary row on a working, non-holiday day.
router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const organizationId = req.user.organization_id;
    const policy = await loadPolicy(organizationId);

    const trendResult = await pool.query(
      `WITH days AS (
         SELECT d::date AS day
         FROM generate_series($2::date - 6, $2::date, interval '1 day') d
       ),
       calendar AS (
         SELECT day,
                EXTRACT(ISODOW FROM day)::int = ANY($3::smallint[])
                AND NOT EXISTS (
                  SELECT 1 FROM attendance.holidays h
                  WHERE h.organization_id = $1 AND h.holiday_date = day
                ) AS working_day
         FROM days
       )
       SELECT c.day::text AS date, c.working_day,
              COUNT(da.id) FILTER (WHERE da.day_status = 'present')::int AS present,
              COUNT(da.id) FILTER (WHERE da.day_status = 'late')::int AS late,
              COUNT(da.id) FILTER (WHERE da.day_status = 'incomplete')::int AS incomplete,
              COUNT(e.id) FILTER (
                WHERE da.id IS NULL AND c.working_day AND e.status = 'active'
              )::int AS absent
       FROM calendar c
       LEFT JOIN attendance.employees e
         ON e.organization_id = $1
        AND (e.created_at AT TIME ZONE $4)::date <= c.day
       LEFT JOIN attendance.daily_attendance da
         ON da.employee_id = e.id AND da.work_date = c.day
       GROUP BY c.day, c.working_day
       ORDER BY c.day`,
      [organizationId, policy.today, policy.working_days, policy.timezone]
    );

    const counts = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_employees,
              COUNT(*) FILTER (WHERE presence = 'inside')::int AS inside_now
       FROM attendance.employees
       WHERE organization_id = $1`,
      [organizationId]
    );

    const trend = trendResult.rows;

    res.json({
      date: policy.today,
      ...counts.rows[0],
      today: trend[trend.length - 1],
      trend,
    });
  })
);

module.exports = router;
