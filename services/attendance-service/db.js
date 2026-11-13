const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.ATTENDANCE_DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on("error", (error) => {
  console.error("Database pool error:", error.code || error.message);
});

// All transaction queries use the same client.
async function transaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await callback(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Closes forgotten check-outs. An employee still "inside" is moved outside
// and that day's summary becomes "incomplete" when either:
//   - the open check-in was on an earlier local date, or
//   - it was before today's auto_close_time and that time has now passed.
// No fake check_out log is written; the summary simply stays incomplete.
// Pass an employeeId to close only that employee (used by punch processing).
async function closeOpenSessions(db, employeeId = null) {
  const result = await db.query(
    `WITH open_sessions AS (
       SELECT e.id, p.timezone, p.auto_close_time,
              (SELECT l.logged_at
               FROM attendance.attendance_logs l
               WHERE l.employee_id = e.id
               ORDER BY l.logged_at DESC
               LIMIT 1) AS checked_in_at
       FROM attendance.employees e
       JOIN attendance.org_policies p ON p.organization_id = e.organization_id
       WHERE e.presence = 'inside'
         AND ($1::uuid IS NULL OR e.id = $1)
     ),
     due AS (
       SELECT id, (checked_in_at AT TIME ZONE timezone)::date AS work_date
       FROM open_sessions
       WHERE checked_in_at IS NULL
          OR (checked_in_at AT TIME ZONE timezone)::date
             < (NOW() AT TIME ZONE timezone)::date
          OR ((checked_in_at AT TIME ZONE timezone)::time < auto_close_time
              AND (NOW() AT TIME ZONE timezone)::time >= auto_close_time)
     ),
     closed AS (
       UPDATE attendance.employees e
       SET presence = 'outside', updated_at = NOW()
       FROM due
       WHERE e.id = due.id AND e.presence = 'inside'
       RETURNING e.id, due.work_date
     )
     UPDATE attendance.daily_attendance d
     SET day_status = 'incomplete'
     FROM closed
     WHERE d.employee_id = closed.id AND d.work_date = closed.work_date`,
    [employeeId]
  );

  return result.rowCount;
}

module.exports = { pool, transaction, closeOpenSessions };
