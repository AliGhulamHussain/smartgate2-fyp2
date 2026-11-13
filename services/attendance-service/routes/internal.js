// Service-to-service routes. Never mapped through the API Gateway.
const express = require("express");
const { pool, transaction, closeOpenSessions } = require("../db");
const { requireInternalKey } = require("../middleware/auth");
const {
  asyncHandler,
  fail,
  validUuid,
  readPunch,
  decideAction,
  checkInStatus,
  checkOutStatus,
} = require("../utils");

const router = express.Router();

router.use(requireInternalKey);

// Repeated recognitions of the same person within this window are ignored.
const COOLDOWN_SECONDS = Number(process.env.PUNCH_COOLDOWN_SECONDS || 180);

if (!Number.isSafeInteger(COOLDOWN_SECONDS) || COOLDOWN_SECONDS < 0) {
  throw new Error("PUNCH_COOLDOWN_SECONDS must be a whole number of seconds.");
}

// Recognition calls this after a successful face match.
// 201 = punch recorded, 200 = punch ignored (with a reason).
router.post(
  "/punch",
  asyncHandler(async (req, res) => {
    const punch = readPunch(req.body);

    const outcome = await transaction(async (client) => {
      // Locking the employee row makes simultaneous punches for the same
      // person run one after another.
      const employeeResult = await client.query(
        `SELECT id, full_name, status
         FROM attendance.employees
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [punch.employee_id, punch.organization_id]
      );
      const employee = employeeResult.rows[0];

      if (!employee) {
        fail(404, "Employee not found in this organization.");
      }
      if (employee.status !== "active") {
        fail(409, "Employee is inactive.");
      }

      const gateResult = await client.query(
        `SELECT id, direction, status
         FROM attendance.gates
         WHERE id = $1 AND organization_id = $2`,
        [punch.gate_id, punch.organization_id]
      );
      const gate = gateResult.rows[0];

      if (!gate) {
        fail(404, "Gate not found in this organization.");
      }
      if (gate.status !== "active") {
        fail(409, "Gate is inactive.");
      }

      // NOW() is fixed for the whole transaction, so every time below agrees.
      const policyResult = await client.query(
        `SELECT p.timezone, p.work_start, p.work_end, p.grace_minutes,
                p.working_days,
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
        [punch.organization_id]
      );
      const policy = policyResult.rows[0];

      if (!policy) {
        fail(409, "Attendance policy is not configured.");
      }

      const recent = await client.query(
        `SELECT 1 FROM attendance.attendance_logs
         WHERE employee_id = $1
           AND logged_at > NOW() - make_interval(secs => $2)
         LIMIT 1`,
        [employee.id, COOLDOWN_SECONDS]
      );

      if (recent.rows[0]) {
        return { ignored: "cooldown", employee };
      }

      // A check-in left open from an earlier day must not block today.
      await closeOpenSessions(client, employee.id);

      const presenceResult = await client.query(
        "SELECT presence FROM attendance.employees WHERE id = $1",
        [employee.id]
      );
      const presence = presenceResult.rows[0].presence;

      const action = decideAction(gate.direction, presence);

      if (!action) {
        return {
          ignored: presence === "inside" ? "already_inside" : "not_inside",
          employee,
        };
      }

      const workingDay =
        policy.working_days.includes(policy.weekday) && !policy.is_holiday;

      let status;
      let lateBy = 0;

      if (action === "check_in") {
        const today = await client.query(
          `SELECT 1 FROM attendance.daily_attendance
           WHERE employee_id = $1 AND work_date = $2`,
          [employee.id, policy.work_date]
        );

        ({ status, late_by_minutes: lateBy } = checkInStatus({
          localTime: policy.local_time,
          workStart: policy.work_start,
          graceMinutes: policy.grace_minutes,
          workingDay,
          firstToday: !today.rows[0],
        }));

        if (!today.rows[0]) {
          await client.query(
            `INSERT INTO attendance.daily_attendance
               (organization_id, employee_id, work_date, first_check_in,
                late_by_minutes, day_status)
             VALUES ($1, $2, $3, NOW(), $4, $5)`,
            [
              punch.organization_id,
              employee.id,
              policy.work_date,
              lateBy,
              status === "late" ? "late" : "present",
            ]
          );
        }
      } else {
        status = checkOutStatus({
          localTime: policy.local_time,
          workEnd: policy.work_end,
          workingDay,
        });

        // Add this visit's minutes to the day the matching check-in belongs to.
        await client.query(
          `WITH last_in AS (
             SELECT logged_at
             FROM attendance.attendance_logs
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
      }

      await client.query(
        `UPDATE attendance.employees
         SET presence = $2, updated_at = NOW()
         WHERE id = $1`,
        [employee.id, action === "check_in" ? "inside" : "outside"]
      );

      const logResult = await client.query(
        `INSERT INTO attendance.attendance_logs
           (organization_id, employee_id, gate_id, action, status,
            late_by_minutes, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, organization_id, employee_id, gate_id, action, status,
                   late_by_minutes, confidence, source, logged_at`,
        [
          punch.organization_id,
          employee.id,
          gate.id,
          action,
          status,
          lateBy,
          punch.confidence,
        ]
      );

      return { log: logResult.rows[0], employee };
    });

    const employee = { id: outcome.employee.id, full_name: outcome.employee.full_name };

    if (outcome.ignored) {
      return res.json({ recorded: false, reason: outcome.ignored, employee });
    }

    res.status(201).json({ recorded: true, log: outcome.log, employee });
  })
);

// Recognition calls this after enrolling or deleting an employee's faces.
// Body: { organization_id, face_enrolled }.
router.put(
  "/employees/:id/face-enrolled",
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    if (
      !validUuid(req.params.id) ||
      !validUuid(body.organization_id) ||
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

module.exports = router;
