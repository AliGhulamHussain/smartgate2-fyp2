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

function readTime(value, fieldName) {
  if (typeof value !== "string") {
    fail(400, `${fieldName} must use HH:MM or HH:MM:SS format.`);
  }

  const match = value.match(
    /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/
  );

  if (!match) {
    fail(400, `${fieldName} must use HH:MM or HH:MM:SS format.`);
  }

  return `${match[1]}:${match[2]}:${match[3] || "00"}`;
}

function readTimezone(value) {
  if (typeof value !== "string" || value.length > 50) {
    fail(400, "timezone must be a valid IANA timezone.");
  }

  const timezone = value.trim();

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    fail(400, "timezone must be a valid IANA timezone.");
  }

  return timezone;
}

function readWorkingDays(value) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 7 ||
    value.some(
      (day) => !Number.isSafeInteger(day) || day < 1 || day > 7
    ) ||
    new Set(value).size !== value.length
  ) {
    fail(400, "working_days must contain unique ISO weekdays from 1 to 7.");
  }

  return [...value].sort((a, b) => a - b);
}

function readPolicy(body) {
  const fields = [
    "timezone",
    "work_start",
    "work_end",
    "grace_minutes",
    "working_days",
    "auto_close_time",
  ];

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== fields.length ||
    fields.some((field) => !(field in body)) ||
    Object.keys(body).some((field) => !fields.includes(field))
  ) {
    fail(400, "Provide all supported attendance policy fields.");
  }

  if (
    !Number.isSafeInteger(body.grace_minutes) ||
    body.grace_minutes < 0 ||
    body.grace_minutes > 1440
  ) {
    fail(400, "grace_minutes must be an integer from 0 to 1440.");
  }

  const policy = {
    timezone: readTimezone(body.timezone),
    work_start: readTime(body.work_start, "work_start"),
    work_end: readTime(body.work_end, "work_end"),
    grace_minutes: body.grace_minutes,
    working_days: readWorkingDays(body.working_days),
    auto_close_time: readTime(body.auto_close_time, "auto_close_time"),
  };

  if (policy.work_start === policy.work_end) {
    fail(400, "work_start and work_end must be different.");
  }

  return policy;
}

module.exports = {
  asyncHandler,
  fail,
  validUuid,
  readPolicy,
};
