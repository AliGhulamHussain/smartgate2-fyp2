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

// face-api (@vladmandic/face-api) descriptors are 128 numbers.
const DESCRIPTOR_LENGTH = 128;
const MIN_SAMPLES = 3;
const MAX_SAMPLES = 10;

function readDescriptor(value, name = "descriptor") {
  if (
    !Array.isArray(value) ||
    value.length !== DESCRIPTOR_LENGTH ||
    value.some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 10)
  ) {
    fail(400, `${name} must be an array of ${DESCRIPTOR_LENGTH} finite numbers.`);
  }
  return value;
}

// Enrollment body: { descriptors: [[128 numbers], ...] } with 3-10 samples.
function readEnrollment(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "descriptors")
  ) {
    fail(400, "Body must be { descriptors: [...] }.");
  }

  const { descriptors } = body;

  if (
    !Array.isArray(descriptors) ||
    descriptors.length < MIN_SAMPLES ||
    descriptors.length > MAX_SAMPLES
  ) {
    fail(400, `descriptors must contain ${MIN_SAMPLES} to ${MAX_SAMPLES} face samples.`);
  }

  return descriptors.map((d, i) => readDescriptor(d, `descriptors[${i}]`));
}

// Identify body from the kiosk: { gate_id, descriptor, liveness_passed? }.
// liveness_passed is the kiosk's blink-check result.
function readIdentify(body) {
  const allowed = ["gate_id", "descriptor", "liveness_passed"];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(400, "Request body must be a JSON object.");
  }

  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));

  if (unknown.length > 0) {
    fail(400, `Unsupported fields: ${unknown.join(", ")}.`);
  }

  if (!validUuid(body.gate_id)) {
    fail(400, "gate_id must be a valid UUID.");
  }

  if (body.liveness_passed !== undefined && typeof body.liveness_passed !== "boolean") {
    fail(400, "liveness_passed must be true or false.");
  }

  return {
    gate_id: body.gate_id,
    descriptor: readDescriptor(body.descriptor),
    liveness_passed: body.liveness_passed === true,
  };
}

// PUT /api/recognition/settings body.
function readSettings(body) {
  const fields = ["match_threshold", "liveness_required"];

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== fields.length ||
    fields.some((field) => !(field in body))
  ) {
    fail(400, "Provide match_threshold and liveness_required only.");
  }

  if (
    typeof body.match_threshold !== "number" ||
    !(body.match_threshold >= 0.2 && body.match_threshold <= 0.8)
  ) {
    fail(400, "match_threshold must be a number from 0.2 to 0.8.");
  }

  if (typeof body.liveness_required !== "boolean") {
    fail(400, "liveness_required must be true or false.");
  }

  return {
    match_threshold: body.match_threshold,
    liveness_required: body.liveness_required,
  };
}

// pgvector accepts the text form "[1,2,3]" cast with ::vector.
function toVector(descriptor) {
  return `[${descriptor.join(",")}]`;
}

// candidates: nearest employees, closest first: [{ employee_id, distance }].
// A match needs the closest person within the threshold AND clearly closer
// than the second-closest person, otherwise the face is treated as unknown.
function decideMatch(candidates, threshold, margin) {
  const [best, second] = candidates;

  if (!best) {
    return { matched: false, reason: "no_enrolled_faces" };
  }
  if (best.distance > threshold) {
    return { matched: false, reason: "no_match", distance: best.distance };
  }
  if (second && second.distance - best.distance < margin) {
    return { matched: false, reason: "ambiguous", distance: best.distance };
  }
  return { matched: true, employee_id: best.employee_id, distance: best.distance };
}

// Calls the Attendance Service. Pass `authorization` to act as the current
// user (public API) or `internal: true` to send the shared service key.
// Returns { status, data }; network failures become a 503.
async function callAttendance(path, { method = "GET", body, authorization, internal } = {}) {
  const headers = {};

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authorization) headers.Authorization = authorization;
  if (internal) headers["X-Internal-Key"] = process.env.INTERNAL_SERVICE_KEY;

  let response;

  try {
    response = await fetch(`${process.env.ATTENDANCE_SERVICE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
  } catch (error) {
    console.error("Attendance call failed:", error.code || error.name);
    fail(503, "Attendance service is unavailable. Try again later.");
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    fail(502, "Attendance service returned an unexpected response.");
  }

  return { status: response.status, data };
}

module.exports = {
  asyncHandler,
  fail,
  validUuid,
  readDescriptor,
  readEnrollment,
  readIdentify,
  readSettings,
  toVector,
  decideMatch,
  callAttendance,
};
