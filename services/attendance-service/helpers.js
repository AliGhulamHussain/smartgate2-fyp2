// Small helpers used by all the routes.

// Lets an async route throw an error; Express passes it to the error handler.
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// Stops the request and sends this status and message to the client.
function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  error.public = true;
  throw error;
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Checks that a request body is an object with only the allowed fields.
// For updates (partial), at least one field must be sent.
function checkBody(body, allowed, { partial = false } = {}) {
  if (!isObject(body)) {
    fail(400, "Request body must be a JSON object.");
  }

  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(400, `Unsupported fields: ${unknown.join(", ")}.`);
  }

  if (partial && Object.keys(body).length === 0) {
    fail(400, "Provide at least one field to update.");
  }
}

// The read* functions below check query-string values.
// Each one returns undefined when the value was not sent.

function readText(value, name, max) {
  if (value === undefined) return undefined;

  if (typeof value !== "string" || value.trim().length > max) {
    fail(400, `${name} must be text of at most ${max} characters.`);
  }
  return value.trim() || undefined;
}

// Like readText, but returns the default when the value is missing.
function readPositiveInt(value, name, defaultValue, max) {
  if (value === undefined) return defaultValue;

  const number = Number(value);
  if (!/^\d+$/.test(String(value)) || number < 1 || number > max) {
    fail(400, `${name} must be an integer from 1 to ${max}.`);
  }
  return number;
}

// A real date in YYYY-MM-DD form (2026-02-30 is rejected).
function readDate(value, name) {
  if (value === undefined) return undefined;

  const valid =
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

  if (!valid) {
    fail(400, `${name} must be a valid date in YYYY-MM-DD format.`);
  }
  return value;
}

function readChoice(value, name, choices) {
  if (value === undefined) return undefined;

  if (!choices.includes(value)) {
    fail(400, `${name} must be one of: ${choices.join(", ")}.`);
  }
  return value;
}

function readUuid(value, name) {
  if (value === undefined) return undefined;

  if (!isUuid(value)) {
    fail(400, `${name} must be a valid UUID.`);
  }
  return value;
}

module.exports = {
  asyncHandler,
  fail,
  isUuid,
  isObject,
  checkBody,
  readText,
  readPositiveInt,
  readDate,
  readChoice,
  readUuid,
};
