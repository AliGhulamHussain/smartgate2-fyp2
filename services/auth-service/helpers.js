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

// Trimmed text, or null if it is missing, empty or too long.
function readText(value, maxLength) {
  if (typeof value !== "string") return null;

  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) return null;

  return cleaned;
}

// Lower-case email, or null if it does not look like an email.
function readEmail(value) {
  const email = readText(value, 150)?.toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

  return email;
}

// At least 12 characters. bcrypt only uses the first 72 bytes, so longer
// passwords are refused instead of being silently cut.
function isValidPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    Buffer.byteLength(value, "utf8") <= 72
  );
}

// Optional department; empty means none.
function readDepartment(value) {
  if (value === undefined || value === null) return null;

  if (typeof value !== "string" || value.trim().length > 100) {
    fail(400, "Department must be a string of up to 100 characters.");
  }

  return value.trim() || null;
}

module.exports = {
  asyncHandler,
  fail,
  isUuid,
  readText,
  readEmail,
  isValidPassword,
  readDepartment,
};
