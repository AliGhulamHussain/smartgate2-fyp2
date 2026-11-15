// Read-only reports for the dashboard: who is inside, punch history,
// the daily report and the overview numbers. Every role can read them,
// and every query only looks at the caller's organization.
const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../auth");
const {
  asyncHandler,
  fail,
  readText,
  readPositiveInt,
  readDate,
  readChoice,
  readUuid,
} = require("../helpers");

const router = express.Router();
router.use(authenticate);

const DAY_STATUSES = ["present", "late", "absent", "holiday", "weekend", "incomplete"];

// Loads the policy plus today's date in the organization's timezone.
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

// GET /api/attendance/presence: who is inside right now, with the time and
// gate of their last check-in.
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

// GET /api/attendance/logs: check-in/check-out history, newest first.
// "from" and "to" are dates (both included) in the organization's timezone.
router.get(
  "/logs",
  asyncHandler(async (req, res) => {
    const page = readPositiveInt(req.query.page, "page", 1, 100000);
    const limit = readPositiveInt(req.query.limit, "limit", 50, 200);
    const from = readDate(req.query.from, "from");
    const to = readDate(req.query.to, "to");
    const employeeId = readUuid(req.query.employee_id, "employee_id");
    const gateId = readUuid(req.query.gate_id, "gate_id");
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

    const where = ["l.organization_id = $1"];
    const values = [req.user.organization_id];

    // A local date starts at midnight in the organization's timezone.
    if (from) {
      values.push(from, policy.timezone);
      where.push(
        `l.logged_at >= ($${values.length - 1}::date::timestamp AT TIME ZONE $${values.length})`
      );
    }
    if (to) {
      values.push(to, policy.timezone);
      where.push(
        `l.logged_at < (($${values.length - 1}::date + 1)::timestamp AT TIME ZONE $${values.length})`
      );
    }
    if (employeeId) {
      values.push(employeeId);
      where.push(`l.employee_id = $${values.length}`);
    }
    if (gateId) {
      values.push(gateId);
      where.push(`l.gate_id = $${values.length}`);
    }
    if (action) {
      values.push(action);
      where.push(`l.action = $${values.length}`);
    }
    if (status) {
      values.push(status);
      where.push(`l.status = $${values.length}`);
    }

    const whereSql = where.join(" AND ");

    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM attendance.attendance_logs l WHERE ${whereSql}`,
      values
    );

    const list = await pool.query(
      `SELECT l.id, l.employee_id, e.employee_code, e.full_name,
              l.gate_id, g.name AS gate_name, l.action, l.status,
              l.late_by_minutes, l.confidence, l.source, l.logged_at
       FROM attendance.attendance_logs l
       JOIN attendance.employees e ON e.id = l.employee_id
       LEFT JOIN attendance.gates g ON g.id = l.gate_id
       WHERE ${whereSql}
       ORDER BY l.logged_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit]
    );

    res.json({ logs: list.rows, page, limit, total: count.rows[0].total });
  })
);

// GET /api/attendance/daily?date=: one row per employee for a date (default today).
//
// Absent days are not stored in the database. An employee with no summary
// row that day is shown as "absent" on a working day, or as "weekend" /
// "holiday" otherwise. Employees added after that date are left out, and
// inactive employees only appear if they have a row.
router.get(
  "/daily",
  asyncHandler(async (req, res) => {
    const page = readPositiveInt(req.query.page, "page", 1, 100000);
    const limit = readPositiveInt(req.query.limit, "limit", 50, 200);
    const department = readText(req.query.department, "department", 100);
    const dayStatus = readChoice(req.query.status, "status", DAY_STATUSES);
    const organizationId = req.user.organization_id;

    const policy = await loadPolicy(organizationId);
    const date = readDate(req.query.date, "date") ?? policy.today;

    if (date > policy.today) {
      fail(400, "date cannot be in the future.");
    }

    // What kind of day was it?
    const holiday = await pool.query(
      `SELECT name FROM attendance.holidays
       WHERE organization_id = $1 AND holiday_date = $2`,
      [organizationId, date]
    );
    const isoWeekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7; // Sunday = 7

    let dayType = "working";
    if (holiday.rows[0]) dayType = "holiday";
    else if (!policy.working_days.includes(isoWeekday)) dayType = "weekend";

    // The status shown for employees who have no row that day.
    const missingStatus = dayType === "working" ? "absent" : dayType;

    const values = [organizationId, date, missingStatus, policy.timezone];
    let departmentSql = "";

    if (department) {
      values.push(department);
      departmentSql = `AND LOWER(e.department) = LOWER($${values.length})`;
    }

    // Every employee for that day, joined with their summary row if any.
    // Used twice below: once for the totals, once for the page of rows.
    const recordsSql = `
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
        ${departmentSql}`;

    // Totals per status, e.g. { present: 10, late: 2, absent: 1, ... }
    const totals = await pool.query(
      `SELECT day_status, COUNT(*)::int AS count
       FROM (${recordsSql}) r
       GROUP BY day_status`,
      values
    );

    const summary = Object.fromEntries(DAY_STATUSES.map((s) => [s, 0]));
    let totalEmployees = 0;
    for (const row of totals.rows) {
      summary[row.day_status] = row.count;
      totalEmployees += row.count;
    }

    // One page of rows, optionally only one status.
    const listValues = [...values];
    let statusSql = "";
    if (dayStatus) {
      listValues.push(dayStatus);
      statusSql = `WHERE day_status = $${listValues.length}`;
    }

    const list = await pool.query(
      `SELECT *, COUNT(*) OVER ()::int AS total_rows
       FROM (${recordsSql}) r
       ${statusSql}
       ORDER BY full_name, employee_code
       LIMIT $${listValues.length + 1} OFFSET $${listValues.length + 2}`,
      [...listValues, limit, (page - 1) * limit]
    );

    res.json({
      date,
      day_type: dayType,
      holiday_name: holiday.rows[0]?.name ?? null,
      summary: { total_employees: totalEmployees, ...summary },
      records: list.rows.map(({ total_rows, ...row }) => row),
      page,
      limit,
      total: dayStatus ? (list.rows[0]?.total_rows ?? 0) : totalEmployees,
    });
  })
);

// GET /api/attendance/stats: numbers for the overview page plus a 7-day trend.
// "absent" uses the same rule as /daily.
router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const organizationId = req.user.organization_id;
    const policy = await loadPolicy(organizationId);

    // For each of the last 7 days: is it a working day, and how many
    // employees were present, late, incomplete or absent.
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

module.exports = { router };
