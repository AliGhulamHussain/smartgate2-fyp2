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

// Optional text fields may be null to clear them.
const employeeTextFields = {
  employee_code: { max: 50, required: true },
  full_name: { max: 100, required: true },
  email: { max: 150 },
  phone: { max: 20 },
  department: { max: 100 },
  designation: { max: 100 },
};

// Validates an employee body. With partial = true (PATCH), fields are
// optional but at least one is needed, and status may be changed.
// presence and face_enrolled are never accepted: punches and
// recognition own those columns.
function readEmployee(body, { partial = false } = {}) {
  const allowed = Object.keys(employeeTextFields);

  if (partial) {
    allowed.push("status");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(400, "Request body must be a JSON object.");
  }

  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));

  if (unknown.length > 0) {
    fail(400, `Unsupported fields: ${unknown.join(", ")}.`);
  }

  if (partial && Object.keys(body).length === 0) {
    fail(400, "Provide at least one field to update.");
  }

  const employee = {};

  for (const [field, rule] of Object.entries(employeeTextFields)) {
    if (!(field in body)) {
      if (rule.required && !partial) {
        fail(400, `${field} is required.`);
      }
      continue;
    }

    let value = body[field];

    if (value === null && !rule.required) {
      employee[field] = null;
      continue;
    }

    if (typeof value !== "string") {
      fail(400, `${field} must be a string.`);
    }

    value = value.trim();

    if (value === "") {
      if (rule.required) {
        fail(400, `${field} cannot be empty.`);
      }
      employee[field] = null;
      continue;
    }

    if (value.length > rule.max) {
      fail(400, `${field} must be at most ${rule.max} characters.`);
    }

    employee[field] = value;
  }

  if (employee.employee_code && !/^[A-Za-z0-9._-]+$/.test(employee.employee_code)) {
    fail(400, "employee_code may contain only letters, digits, '.', '_' and '-'.");
  }

  if (employee.email) {
    employee.email = employee.email.toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email)) {
      fail(400, "email must be a valid email address.");
    }
  }

  if (employee.phone && !/^\+?[0-9][0-9 -]{5,18}$/.test(employee.phone)) {
    fail(400, "phone must contain 6-20 digits, spaces or dashes, optionally starting with +.");
  }

  if ("status" in body) {
    if (!["active", "inactive"].includes(body.status)) {
      fail(400, "status must be active or inactive.");
    }
    employee.status = body.status;
  }

  return employee;
}

module.exports = {
  asyncHandler,
  fail,
  validUuid,
  readPolicy,
  readEmployee,
};
