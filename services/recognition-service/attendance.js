// Calls to the Attendance service.
//
// Recognition is not allowed to read the attendance tables, so it asks the
// Attendance API instead. Reading an employee or gate is done "as the user"
// (with their token), which also proves it belongs to their organization.
// Changing data uses the /internal routes with the shared secret key.
const { fail } = require("./helpers");

// Sends one request and returns { status, data }.
// Pass `authorization` to act as the user, or `internal: true` for /internal routes.
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

  let data;
  try {
    data = await response.json();
  } catch {
    fail(502, "Attendance service returned an unexpected response.");
  }

  return { status: response.status, data };
}

async function getEmployee(authorization, employeeId) {
  const { status, data } = await callAttendance(`/api/attendance/employees/${employeeId}`, {
    authorization,
  });

  if (status === 404) fail(404, "Employee not found.");
  if (status === 401 || status === 403) fail(status, data?.message || "Access denied.");
  if (status !== 200 || !data?.employee) {
    fail(502, "Attendance service returned an unexpected response.");
  }
  return data.employee;
}

async function getGate(authorization, gateId) {
  const { status, data } = await callAttendance(`/api/attendance/gates/${gateId}`, {
    authorization,
  });

  if (status === 404) fail(404, "Gate not found.");
  if (status !== 200) fail(502, "Could not verify the gate.");
  return data.gate;
}

async function setFaceEnrolled(organizationId, employeeId, faceEnrolled) {
  const { status } = await callAttendance(`/internal/employees/${employeeId}/face-enrolled`, {
    method: "PUT",
    internal: true,
    body: { organization_id: organizationId, face_enrolled: faceEnrolled },
  });

  if (status === 404) fail(404, "Employee not found.");
  if (status !== 200) fail(502, "Could not update the employee's enrollment status.");
}

// Records a check-in or check-out. Returns Attendance's answer:
// { recorded: true, log, employee } or { recorded: false, reason, employee }.
async function recordPunch(punch) {
  const { status, data } = await callAttendance("/internal/punch", {
    method: "POST",
    internal: true,
    body: punch,
  });

  // e.g. 409 "Employee is inactive." or "Attendance policy is not configured."
  if (status === 404 || status === 409) {
    fail(status, data?.message || "Attendance rejected the punch.");
  }
  if (status !== 200 && status !== 201) {
    fail(502, "Attendance service could not record the punch.");
  }
  return data;
}

module.exports = { getEmployee, getGate, setFaceEnrolled, recordPunch };
