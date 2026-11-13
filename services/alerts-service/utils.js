const crypto = require("crypto");

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  error.public = true;
  throw error;
}

function validUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function readPositiveInt(value, name, fallback, max) {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!/^\d+$/.test(String(value)) || number < 1 || number > max) {
    fail(400, `${name} must be an integer from 1 to ${max}.`);
  }
  return number;
}

// Optional query-string value that must be one of a fixed list.
function readChoice(value, name, choices) {
  if (value === undefined) {
    return undefined;
  }
  if (!choices.includes(value)) {
    fail(400, `${name} must be one of: ${choices.join(", ")}.`);
  }
  return value;
}

// The same text always gives the same UUID. Used to turn a Redis stream
// message id into the alert id, so re-processing a message cannot create
// a duplicate alert.
function uuidFromText(text) {
  const hex = crypto.createHash("sha256").update(text).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

// Validates an unknown-face message read from the Redis Stream (all fields
// arrive as strings). Returns the event with the JPEG decoded to bytes.
function readUnknownFaceEvent(fields) {
  if (!validUuid(fields.organization_id)) {
    fail(400, "organization_id is invalid.");
  }
  if (!validUuid(fields.gate_id)) {
    fail(400, "gate_id is invalid.");
  }

  const bestDistance = fields.best_distance === "" ? null : Number(fields.best_distance);
  if (bestDistance !== null && !Number.isFinite(bestDistance)) {
    fail(400, "best_distance is invalid.");
  }

  if (typeof fields.captured_at !== "string" || Number.isNaN(Date.parse(fields.captured_at))) {
    fail(400, "captured_at is invalid.");
  }

  const snapshot =
    typeof fields.snapshot === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(fields.snapshot)
      ? Buffer.from(fields.snapshot, "base64")
      : Buffer.alloc(0);

  if (snapshot.length < 4 || snapshot[0] !== 0xff || snapshot[1] !== 0xd8 || snapshot[2] !== 0xff) {
    fail(400, "snapshot is not a JPEG image.");
  }

  return {
    organization_id: fields.organization_id,
    gate_id: fields.gate_id,
    best_distance: bestDistance,
    recognition_event_id: validUuid(fields.recognition_event_id) ? fields.recognition_event_id : null,
    captured_at: new Date(fields.captured_at).toISOString(),
    snapshot,
  };
}

// PATCH /api/alerts/unknown-faces/:id body: { status, note? }.
function readReview(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !["status", "note"].includes(key))
  ) {
    fail(400, "Body must be { status, note? }.");
  }

  if (!["new", "reviewed", "dismissed"].includes(body.status)) {
    fail(400, "status must be new, reviewed or dismissed.");
  }

  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string" || body.note.trim().length > 500) {
      fail(400, "note must be text of at most 500 characters.");
    }
    note = body.note.trim() || null;
  }

  return { status: body.status, note };
}

const ALERT_TYPES = ["unknown_face", "late_arrival", "forgot_checkout", "daily_summary"];

// POST /api/alerts/recipients body: { email, alert_types? }.
function readRecipient(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !["email", "alert_types"].includes(key))
  ) {
    fail(400, "Body must be { email, alert_types? }.");
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, "email must be a valid email address.");
  }

  let alertTypes = ALERT_TYPES;
  if (body.alert_types !== undefined) {
    if (
      !Array.isArray(body.alert_types) ||
      body.alert_types.length === 0 ||
      body.alert_types.some((type) => !ALERT_TYPES.includes(type)) ||
      new Set(body.alert_types).size !== body.alert_types.length
    ) {
      fail(400, `alert_types must be a non-empty list of: ${ALERT_TYPES.join(", ")}.`);
    }
    alertTypes = body.alert_types;
  }

  return { email, alert_types: alertTypes };
}

module.exports = {
  asyncHandler,
  fail,
  validUuid,
  readPositiveInt,
  readChoice,
  uuidFromText,
  readUnknownFaceEvent,
  readReview,
  readRecipient,
};
