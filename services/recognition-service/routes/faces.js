// Face enrollment. Only descriptors (128 numbers) are stored, never images,
// and raw descriptors are never returned by the API.
const express = require("express");
const { pool, transaction, loadSettings } = require("../db");
const {
  authenticate,
  requireOrganization,
  allowRoles,
} = require("../middleware/auth");
const {
  asyncHandler,
  fail,
  validUuid,
  readEnrollment,
  toVector,
  callAttendance,
} = require("../utils");

const router = express.Router();

router.use(authenticate, requireOrganization);

function readEmployeeId(req) {
  if (!validUuid(req.params.id)) {
    fail(400, "Employee id must be a valid UUID.");
  }
  return req.params.id;
}

// Recognition cannot read the Attendance schema, so it asks the Attendance
// API as the current user. That also proves the employee is in their org.
async function fetchEmployee(req, employeeId) {
  const { status, data } = await callAttendance(
    `/api/attendance/employees/${employeeId}`,
    { authorization: req.get("Authorization") }
  );

  if (status === 404) fail(404, "Employee not found.");
  if (status === 401 || status === 403) fail(status, data?.message || "Access denied.");
  if (status !== 200 || !data?.employee) {
    fail(502, "Attendance service returned an unexpected response.");
  }

  return data.employee;
}

async function setFaceEnrolled(organizationId, employeeId, faceEnrolled) {
  const { status } = await callAttendance(
    `/internal/employees/${employeeId}/face-enrolled`,
    {
      method: "PUT",
      internal: true,
      body: { organization_id: organizationId, face_enrolled: faceEnrolled },
    }
  );

  if (status === 404) fail(404, "Employee not found.");
  if (status !== 200) fail(502, "Could not update the employee's enrollment status.");
}

// GET /api/recognition/employees/:id/faces: how many samples are enrolled.
router.get(
  "/:id/faces",
  asyncHandler(async (req, res) => {
    const employeeId = readEmployeeId(req);

    const result = await pool.query(
      `SELECT COUNT(*)::int AS samples, MAX(created_at) AS enrolled_at
       FROM recognition.face_embeddings
       WHERE organization_id = $1 AND employee_id = $2`,
      [req.user.organization_id, employeeId]
    );

    res.json({ employee_id: employeeId, ...result.rows[0] });
  })
);

// PUT /api/recognition/employees/:id/faces: enroll 3-10 samples,
// replacing any previous samples for this employee.
router.put(
  "/:id/faces",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const employeeId = readEmployeeId(req);
    const descriptors = readEnrollment(req.body).map(toVector);
    const organizationId = req.user.organization_id;

    const employee = await fetchEmployee(req, employeeId);

    if (employee.status !== "active") {
      fail(409, "Only active employees can be enrolled.");
    }

    // One person must not be enrolled as two employees (buddy punching).
    const settings = await loadSettings(organizationId);
    const duplicate = await pool.query(
      `SELECT MIN(f.embedding <-> s.v::vector) AS distance
       FROM unnest($2::text[]) AS s(v)
       JOIN recognition.face_embeddings f
         ON f.organization_id = $1 AND f.employee_id <> $3`,
      [organizationId, descriptors, employeeId]
    );

    const nearest = duplicate.rows[0].distance;
    if (nearest !== null && nearest <= settings.match_threshold) {
      fail(409, "This face is already enrolled for another employee.");
    }

    await transaction(async (client) => {
      await client.query(
        `DELETE FROM recognition.face_embeddings
         WHERE organization_id = $1 AND employee_id = $2`,
        [organizationId, employeeId]
      );

      await client.query(
        `INSERT INTO recognition.face_embeddings (organization_id, employee_id, embedding)
         SELECT $1, $2, v::vector FROM unnest($3::text[]) AS v`,
        [organizationId, employeeId, descriptors]
      );

      // If Attendance cannot be updated, the samples are rolled back.
      await setFaceEnrolled(organizationId, employeeId, true);
    });

    res.json({ employee_id: employeeId, samples: descriptors.length, face_enrolled: true });
  })
);

// DELETE /api/recognition/employees/:id/faces: remove all samples.
router.delete(
  "/:id/faces",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const employeeId = readEmployeeId(req);
    const organizationId = req.user.organization_id;

    const removed = await transaction(async (client) => {
      const result = await client.query(
        `DELETE FROM recognition.face_embeddings
         WHERE organization_id = $1 AND employee_id = $2`,
        [organizationId, employeeId]
      );

      await setFaceEnrolled(organizationId, employeeId, false);
      return result.rowCount;
    });

    res.json({ employee_id: employeeId, removed, face_enrolled: false });
  })
);

module.exports = router;
