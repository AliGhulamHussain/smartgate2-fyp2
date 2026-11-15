// POST /api/recognition/identify
// The gate kiosk sends one face descriptor. We find the closest enrolled
// employee; a match becomes a check-in/out in the Attendance service, and an
// unknown face (with a photo) becomes an alert for the Alerts service.
const express = require("express");
const { pool, loadSettings } = require("../db");
const { authenticate, allowRoles } = require("../auth");
const { asyncHandler, fail, isUuid, isObject } = require("../helpers");
const { readDescriptor, toVector, decideMatch } = require("../matching");
const { getGate, recordPunch } = require("../attendance");
const { publishUnknownFace } = require("../events");

const router = express.Router();

// The best match must be at least this much closer than the second-best
// person. Tune with RECOGNITION_MATCH_MARGIN during demo testing.
const MATCH_MARGIN = Number(process.env.RECOGNITION_MATCH_MARGIN || 0.05);

if (!(MATCH_MARGIN >= 0 && MATCH_MARGIN < 1)) {
  throw new Error("RECOGNITION_MATCH_MARGIN must be a number from 0 to 1.");
}

const MAX_SNAPSHOT_BYTES = 200 * 1024;

// Optional JPEG photo of the face, as base64 or "data:image/jpeg;base64,...".
// Returns plain base64, or null when no photo was sent.
function readSnapshot(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const base64 = typeof value === "string" ? value.replace(/^data:image\/jpeg;base64,/, "") : "";
  const bytes = /^[A-Za-z0-9+/]+={0,2}$/.test(base64)
    ? Buffer.from(base64, "base64")
    : Buffer.alloc(0);

  // Every JPEG file starts with the bytes FF D8 FF.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    fail(400, "snapshot must be a base64 JPEG image.");
  }
  if (bytes.length > MAX_SNAPSHOT_BYTES) {
    fail(400, "snapshot must be at most 200 KB.");
  }

  return base64;
}

// Body: { gate_id, descriptor, liveness_passed?, snapshot? }
// liveness_passed is the result of the kiosk's blink check.
function readIdentify(body) {
  const allowed = ["gate_id", "descriptor", "liveness_passed", "snapshot"];

  if (!isObject(body)) {
    fail(400, "Request body must be a JSON object.");
  }

  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(400, `Unsupported fields: ${unknown.join(", ")}.`);
  }

  if (!isUuid(body.gate_id)) {
    fail(400, "gate_id must be a valid UUID.");
  }

  if (body.liveness_passed !== undefined && typeof body.liveness_passed !== "boolean") {
    fail(400, "liveness_passed must be true or false.");
  }

  return {
    gate_id: body.gate_id,
    descriptor: readDescriptor(body.descriptor),
    liveness_passed: body.liveness_passed === true,
    snapshot: readSnapshot(body.snapshot),
  };
}

router.post(
  "/",
  authenticate,
  allowRoles("org_admin", "gate_operator"),
  asyncHandler(async (req, res) => {
    const input = readIdentify(req.body);
    const organizationId = req.user.organization_id;
    const settings = await loadSettings(organizationId);

    // 1. Checks: blink check passed, gate belongs to this organization and is active.
    if (settings.liveness_required && !input.liveness_passed) {
      fail(400, "Liveness check (blink) is required before identification.");
    }

    const gate = await getGate(req.get("Authorization"), input.gate_id);
    if (gate.status !== "active") {
      fail(409, "Gate is inactive.");
    }

    // 2. Find the two closest employees. Each employee has several samples,
    //    so we take their closest sample (MIN distance).
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

    // 3. Save every attempt, matched or not.
    const event = await pool.query(
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

    // 4a. Unknown face: send the photo to the Alerts service (if there is one).
    if (!decision.matched) {
      const alertQueued =
        input.snapshot !== null &&
        (await publishUnknownFace({
          organization_id: organizationId,
          gate_id: input.gate_id,
          best_distance: decision.distance ?? null,
          recognition_event_id: event.rows[0].id,
          captured_at: event.rows[0].created_at.toISOString(),
          snapshot: input.snapshot,
        }));

      return res.json({
        matched: false,
        reason: decision.reason,
        distance: decision.distance ?? null,
        alert_queued: alertQueued,
      });
    }

    // 4b. Known face: record the check-in or check-out.
    //     Confidence is 1 - distance (closer face = higher confidence).
    const punch = await recordPunch({
      organization_id: organizationId,
      employee_id: decision.employee_id,
      gate_id: input.gate_id,
      confidence: Math.max(0, Math.min(1, 1 - decision.distance)),
    });

    res.json({
      matched: true,
      distance: decision.distance,
      employee: punch.employee,
      attendance: punch.recorded
        ? {
            recorded: true,
            action: punch.log.action,
            status: punch.log.status,
            late_by_minutes: punch.log.late_by_minutes,
            logged_at: punch.log.logged_at,
          }
        : { recorded: false, reason: punch.reason },
    });
  })
);

module.exports = { router, readIdentify };
