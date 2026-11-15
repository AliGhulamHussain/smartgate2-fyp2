// Routes that only other services call (never the browser).
// The API Gateway does not forward /internal, and every request needs the
// shared secret key (see requireInternalKey in auth.js).
const express = require("express");
const { pool, transaction, closeOpenSessions } = require("../db");
const { requireInternalKey } = require("../auth");
const { asyncHandler, fail, isUuid, checkBody } = require("../helpers");
const { decideAction, checkInStatus, checkOutStatus } = require("../rules");

const router = express.Router();
router.use(requireInternalKey);

// The same person recognised again within this time is ignored, so one
// visit is not recorded many times while they stand at the camera.
const COOLDOWN_SECONDS = Number(process.env.PUNCH_COOLDOWN_SECONDS || 180);

if (!Number.isSafeInteger(COOLDOWN_SECONDS) || COOLDOWN_SECONDS < 0) {
  throw new Error("PUNCH_COOLDOWN_SECONDS must be a whole number of seconds.");
}

// Checks the body Recognition sends: { organization_id, employee_id, gate_id, confidence? }
function readPunch(body) {
  checkBody(body, ["organization_id", "employee_id", "gate_id", "confidence"]);

  for (const field of ["organization_id", "employee_id", "gate_id"]) {
    if (!isUuid(body[field])) {
      fail(400, `${field} must be a valid UUID.`);
    }
  }

  const confidence = body.confidence ?? null;
  if (
    confidence !== null &&
    (typeof confidence !== "number" || !(confidence >= 0 && confidence <= 1))
  ) {
    fail(400, "confidence must be a number from 0 to 1.");
  }

  return {
    organization_id: body.organization_id,
    employee_id: body.employee_id,
    gate_id: body.gate_id,
    confidence,
  };
}

// ---- Steps of a punch. Each one gets the same transaction client. ----

// FOR UPDATE locks the employee row until the transaction ends, so if five
// punches for the same person arrive together they run one after another.
async function loadEmployee(client, punch) {
  const result = await client.query(
    `SELECT id, organization_id, full_name, status FROM attendance.employees
     WHERE id = $1 AND organization_id = $2
     FOR UPDATE`,
    [punch.employee_id, punch.organization_id]
  );
  const employee = result.rows[0];

  if (!employee) fail(404, "Employee not found in this organization.");
  if (employee.status !== "active") fail(409, "Employee is inactive.");
  return employee;
}

async function loadGate(client, punch) {
  const result = await client.query(
    `SELECT id, direction, status FROM attendance.gates
     WHERE id = $1 AND organization_id = $2`,
    [punch.gate_id, punch.organization_id]
  );
  const gate = result.rows[0];

  if (!gate) fail(404, "Gate not found in this organization.");
  if (gate.status !== "active") fail(409, "Gate is inactive.");
  return gate;
}

// Loads the policy together with today's date, the local time, the weekday
// and whether today is a holiday, all in the organization's timezone.
// NOW() stays the same during a transaction, so all these values agree.
async function loadPolicyNow(client, organizationId) {
  const result = await client.query(
    `SELECT p.timezone, p.work_start, p.work_end, p.grace_minutes, p.working_days,
            (NOW() AT TIME ZONE p.timezone)::date::text AS work_date,
            (NOW() AT TIME ZONE p.timezone)::time AS local_time,
            EXTRACT(ISODOW FROM NOW() AT TIME ZONE p.timezone)::int AS weekday,
            EXISTS (
              SELECT 1 FROM attendance.holidays h
              WHERE h.organization_id = p.organization_id
                AND h.holiday_date = (NOW() AT TIME ZONE p.timezone)::date
            ) AS is_holiday
     FROM attendance.org_policies p
     WHERE p.organization_id = $1`,
    [organizationId]
  );
  const policy = result.rows[0];

  if (!policy) fail(409, "Attendance policy is not configured.");
  return policy;
}

async function punchedRecently(client, employeeId) {
  const result = await client.query(
    `SELECT 1 FROM attendance.attendance_logs
     WHERE employee_id = $1 AND logged_at > NOW() - make_interval(secs => $2)
     LIMIT 1`,
    [employeeId, COOLDOWN_SECONDS]
  );
  return result.rows.length > 0;
}

async function getPresence(client, employeeId) {
  const result = await client.query(
    "SELECT presence FROM attendance.employees WHERE id = $1",
    [employeeId]
  );
  return result.rows[0].presence;
}

// Check-in: work out on_time / late / normal, and create today's summary
// row if this is the first check-in of the day.
async function recordCheckIn(client, employee, policy, workingDay) {
  const today = await client.query(
    `SELECT 1 FROM attendance.daily_attendance
     WHERE employee_id = $1 AND work_date = $2`,
    [employee.id, policy.work_date]
  );
  const firstToday = today.rows.length === 0;

  const { status, late_by_minutes } = checkInStatus({
    localTime: policy.local_time,
    workStart: policy.work_start,
    graceMinutes: policy.grace_minutes,
    workingDay,
    firstToday,
  });

  if (firstToday) {
    await client.query(
      `INSERT INTO attendance.daily_attendance
         (organization_id, employee_id, work_date, first_check_in,
          late_by_minutes, day_status)
       VALUES ($1, $2, $3, NOW(), $4, $5)`,
      [
        employee.organization_id,
        employee.id,
        policy.work_date,
        late_by_minutes,
        status === "late" ? "late" : "present",
      ]
    );
  }

  return { status, late_by_minutes };
}

// Check-out: work out normal / early_leave, and add the minutes since the
// last check-in to the day that check-in belongs to.
async function recordCheckOut(client, employee, policy, workingDay) {
  const status = checkOutStatus({
    localTime: policy.local_time,
    workEnd: policy.work_end,
    workingDay,
  });

  await client.query(
    `WITH last_in AS (
       SELECT logged_at FROM attendance.attendance_logs
       WHERE employee_id = $1 AND action = 'check_in'
       ORDER BY logged_at DESC
       LIMIT 1
     )
     UPDATE attendance.daily_attendance d
     SET last_check_out = NOW(),
         total_minutes = d.total_minutes
           + FLOOR(EXTRACT(EPOCH FROM NOW() - last_in.logged_at) / 60)::int
     FROM last_in
     WHERE d.employee_id = $1
       AND d.work_date = (last_in.logged_at AT TIME ZONE $2)::date`,
    [employee.id, policy.timezone]
  );

  return { status, late_by_minutes: 0 };
}

// POST /internal/punch
// Recognition calls this after it matches a face.
// Answers 201 when the punch was recorded, or 200 with a reason when it
// was ignored ("cooldown", "already_inside" or "not_inside").
router.post(
  "/punch",
  asyncHandler(async (req, res) => {
    const punch = readPunch(req.body);

    const outcome = await transaction(async (client) => {
      const employee = await loadEmployee(client, punch);
      const gate = await loadGate(client, punch);
      const policy = await loadPolicyNow(client, punch.organization_id);

      if (await punchedRecently(client, employee.id)) {
        return { employee, ignored: "cooldown" };
      }

      // A check-in left open from an earlier day must not block today.
      await closeOpenSessions(client, employee.id);

      const presence = await getPresence(client, employee.id);
      const action = decideAction(gate.direction, presence);

      if (!action) {
        const reason = presence === "inside" ? "already_inside" : "not_inside";
        return { employee, ignored: reason };
      }

      const workingDay = policy.working_days.includes(policy.weekday) && !policy.is_holiday;

      const { status, late_by_minutes } =
        action === "check_in"
          ? await recordCheckIn(client, employee, policy, workingDay)
          : await recordCheckOut(client, employee, policy, workingDay);

      await client.query(
        "UPDATE attendance.employees SET presence = $2, updated_at = NOW() WHERE id = $1",
        [employee.id, action === "check_in" ? "inside" : "outside"]
      );

      const log = await client.query(
        `INSERT INTO attendance.attendance_logs
           (organization_id, employee_id, gate_id, action, status,
            late_by_minutes, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, organization_id, employee_id, gate_id, action, status,
                   late_by_minutes, confidence, source, logged_at`,
        [punch.organization_id, employee.id, gate.id, action, status, late_by_minutes, punch.confidence]
      );

      return { employee, log: log.rows[0] };
    });

    const employee = { id: outcome.employee.id, full_name: outcome.employee.full_name };

    if (outcome.ignored) {
      return res.json({ recorded: false, reason: outcome.ignored, employee });
    }

    res.status(201).json({ recorded: true, log: outcome.log, employee });
  })
);

// PUT /internal/employees/:id/face-enrolled
// Recognition calls this after it saves or deletes an employee's face.
// Body: { organization_id, face_enrolled: true | false }
router.put(
  "/employees/:id/face-enrolled",
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    if (
      !isUuid(req.params.id) ||
      !isUuid(body.organization_id) ||
      typeof body.face_enrolled !== "boolean" ||
      Object.keys(body).length !== 2
    ) {
      fail(400, "Provide a valid employee id, organization_id and boolean face_enrolled.");
    }

    const result = await pool.query(
      `UPDATE attendance.employees
       SET face_enrolled = $3, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING id, face_enrolled`,
      [req.params.id, body.organization_id, body.face_enrolled]
    );

    if (!result.rows[0]) {
      fail(404, "Employee not found in this organization.");
    }

    res.json({ employee: result.rows[0] });
  })
);

module.exports = { router, readPunch };
