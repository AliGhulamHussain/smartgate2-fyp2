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

// Query-string number such as ?page=2. Returns the default when missing.
function readPositiveInt(value, name, defaultValue, max) {
  if (value === undefined) return defaultValue;

  const number = Number(value);
  if (!/^\d+$/.test(String(value)) || number < 1 || number > max) {
    fail(400, `${name} must be an integer from 1 to ${max}.`);
  }
  return number;
}

// Query-string value that must be one of a fixed list. Undefined when missing.
function readChoice(value, name, choices) {
  if (value === undefined) return undefined;

  if (!choices.includes(value)) {
    fail(400, `${name} must be one of: ${choices.join(", ")}.`);
  }
  return value;
}

module.exports = { asyncHandler, fail, isUuid, isObject, readPositiveInt, readChoice };
