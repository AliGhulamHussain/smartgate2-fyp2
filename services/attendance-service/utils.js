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

// Validates a gate body. With partial = true (PATCH), fields are optional
// but at least one is needed, and status may be changed.
function readGate(body, { partial = false } = {}) {
  const allowed = partial ? ["name", "direction", "status"] : ["name", "direction"];

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

  const gate = {};

  if ("name" in body || !partial) {
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (name === "" || name.length > 80) {
      fail(400, "name is required and must be at most 80 characters.");
    }
    gate.name = name;
  }

  if ("direction" in body) {
    if (!["entry", "exit", "both"].includes(body.direction)) {
      fail(400, "direction must be entry, exit or both.");
    }
    gate.direction = body.direction;
  }

  if ("status" in body) {
    if (!["active", "inactive"].includes(body.status)) {
      fail(400, "status must be active or inactive.");
    }
    gate.status = body.status;
  }

  return gate;
}

// Validates the body Recognition sends to POST /internal/punch.
function readPunch(body) {
  const allowed = ["organization_id", "employee_id", "gate_id", "confidence"];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(400, "Request body must be a JSON object.");
  }

  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));

  if (unknown.length > 0) {
    fail(400, `Unsupported fields: ${unknown.join(", ")}.`);
  }

  for (const field of ["organization_id", "employee_id", "gate_id"]) {
    if (!validUuid(body[field])) {
      fail(400, `${field} must be a valid UUID.`);
    }
  }

  const confidence = body.confidence ?? null;

  if (
    confidence !== null &&
    (typeof confidence !== "number" || !(confidence >= 0 && confidence <= 1))
  ) {
    fail(400, "confidence must be a number from 0 to 1.");
  }

  return {
    organization_id: body.organization_id,
    employee_id: body.employee_id,
    gate_id: body.gate_id,
    confidence,
  };
}

// "HH:MM:SS" or "HH:MM:SS.ffffff" (as PostgreSQL returns time) -> seconds.
function timeToSeconds(value) {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return hours * 3600 + minutes * 60 + Math.floor(seconds);
}

// Entry gates only check in, exit gates only check out, and "both" gates
// toggle on current presence. Returns null when the punch makes no sense
// (entering while already inside, or leaving while outside).
function decideAction(direction, presence) {
  if (direction === "entry") {
    return presence === "outside" ? "check_in" : null;
  }
  if (direction === "exit") {
    return presence === "inside" ? "check_out" : null;
  }
  return presence === "inside" ? "check_out" : "check_in";
}

// ponytail: assumes work_start < work_end on the same day; overnight shifts
// are not supported for lateness or early-leave.
//
// Only the first check-in of a working day is judged. It is late when it is
// more than grace_minutes after work_start, and late_by_minutes then counts
// from work_start. Later re-entries (after lunch) are "normal".
function checkInStatus({ localTime, workStart, graceMinutes, workingDay, firstToday }) {
  if (!firstToday) {
    return { status: "normal", late_by_minutes: 0 };
  }

  const secondsLate = timeToSeconds(localTime) - timeToSeconds(workStart);

  if (workingDay && secondsLate > graceMinutes * 60) {
    return { status: "late", late_by_minutes: Math.floor(secondsLate / 60) };
  }

  return { status: "on_time", late_by_minutes: 0 };
}

// Leaving before work_end on a working day is an early leave.
function checkOutStatus({ localTime, workEnd, workingDay }) {
  if (workingDay && timeToSeconds(localTime) < timeToSeconds(workEnd)) {
    return "early_leave";
  }
  return "normal";
}

// Optional query-string text; empty means "not given".
function readQueryText(value, name, max) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length > max) {
    fail(400, `${name} must be text of at most ${max} characters.`);
  }
  return value.trim() || undefined;
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

// Optional query-string date in YYYY-MM-DD form that must be a real date.
function readDate(value, name) {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    fail(400, `${name} must be a valid date in YYYY-MM-DD format.`);
  }
  return value;
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

// Optional query-string UUID.
function readQueryUuid(value, name) {
  if (value === undefined) {
    return undefined;
  }
  if (!validUuid(value)) {
    fail(400, `${name} must be a valid UUID.`);
  }
  return value;
}

module.exports = {
  asyncHandler,
  fail,
  validUuid,
  readQueryText,
  readPositiveInt,
  readDate,
  readChoice,
  readQueryUuid,
  readPolicy,
  readEmployee,
  readGate,
  readPunch,
  decideAction,
  checkInStatus,
  checkOutStatus,
};
