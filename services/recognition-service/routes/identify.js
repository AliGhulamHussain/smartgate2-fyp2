// POST /api/recognition/identify: the gate kiosk sends one face descriptor
// (computed in the browser by @vladmandic/face-api). A match is passed to
// the Attendance Service as a punch.
const express = require("express");
const { pool, loadSettings } = require("../db");
const {
  authenticate,
  requireOrganization,
  allowRoles,
} = require("../middleware/auth");
const {
  asyncHandler,
  fail,
  readIdentify,
  toVector,
  decideMatch,
  callAttendance,
} = require("../utils");
const { publishUnknownFace } = require("../events");

const router = express.Router();

// The best match must be at least this much closer than the second-best
// person. Tune with RECOGNITION_MATCH_MARGIN during demo testing.
const MATCH_MARGIN = Number(process.env.RECOGNITION_MATCH_MARGIN || 0.05);

if (!(MATCH_MARGIN >= 0 && MATCH_MARGIN < 1)) {
  throw new Error("RECOGNITION_MATCH_MARGIN must be a number from 0 to 1.");
}

router.post(
  "/",
  authenticate,
  requireOrganization,
  allowRoles("org_admin", "gate_operator"),
  asyncHandler(async (req, res) => {
    const input = readIdentify(req.body);
    const organizationId = req.user.organization_id;
    const settings = await loadSettings(organizationId);

    if (settings.liveness_required && !input.liveness_passed) {
      fail(400, "Liveness check (blink) is required before identification.");
    }

    // The gate must belong to this organization and be active.
    const gate = await callAttendance(`/api/attendance/gates/${input.gate_id}`, {
      authorization: req.get("Authorization"),
    });

    if (gate.status === 404) fail(404, "Gate not found.");
    if (gate.status !== 200) fail(502, "Could not verify the gate.");
    if (gate.data.gate.status !== "active") fail(409, "Gate is inactive.");

    // ponytail: scans every sample in the organization, fine for thousands;
    // for much more, add the HNSW index and search the nearest samples first.
    const candidates = await pool.query(
      `SELECT employee_id, MIN(embedding <-> $2::vector) AS distance
       FROM recognition.face_embeddings
       WHERE organization_id = $1
       GROUP BY employee_id
       ORDER BY distance
       LIMIT 2`,
      [organizationId, toVector(input.descriptor)]
    );

    const decision = decideMatch(candidates.rows, settings.match_threshold, MATCH_MARGIN);

    const eventResult = await pool.query(
      `INSERT INTO recognition.recognition_events
         (organization_id, employee_id, gate_id, distance, matched)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [
        organizationId,
        decision.matched ? decision.employee_id : null,
        input.gate_id,
        decision.distance ?? null,
        decision.matched,
      ]
    );

    if (!decision.matched) {
      // Unknown face: hand the snapshot to the Alerts Service.
      const alertQueued =
        input.snapshot !== null &&
        (await publishUnknownFace({
          organization_id: organizationId,
          gate_id: input.gate_id,
          best_distance: decision.distance ?? null,
          recognition_event_id: eventResult.rows[0].id,
          captured_at: eventResult.rows[0].created_at.toISOString(),
          snapshot: input.snapshot,
        }));

      return res.json({
        matched: false,
        reason: decision.reason,
        distance: decision.distance ?? null,
        alert_queued: alertQueued,
      });
    }

    const punch = await callAttendance("/internal/punch", {
      method: "POST",
      internal: true,
      body: {
        organization_id: organizationId,
        employee_id: decision.employee_id,
        gate_id: input.gate_id,
        confidence: Math.max(0, Math.min(1, 1 - decision.distance)),
      },
    });

    // e.g. 409 "Employee is inactive." or "Attendance policy is not configured."
    if (punch.status === 404 || punch.status === 409) {
      fail(punch.status, punch.data?.message || "Attendance rejected the punch.");
    }
    if (punch.status !== 200 && punch.status !== 201) {
      fail(502, "Attendance service could not record the punch.");
    }

    res.json({
      matched: true,
      distance: decision.distance,
      employee: punch.data.employee,
      attendance: punch.data.recorded
        ? {
            recorded: true,
            action: punch.data.log.action,
            status: punch.data.log.status,
            late_by_minutes: punch.data.log.late_by_minutes,
            logged_at: punch.data.log.logged_at,
          }
        : { recorded: false, reason: punch.data.reason },
    });
  })
);

module.exports = router;
