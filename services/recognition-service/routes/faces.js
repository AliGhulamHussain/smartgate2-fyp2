// Face enrollment: saving and removing an employee's face samples.
// Only the 128 numbers are stored, never a photo, and the numbers are
// never sent back out by the API.
const express = require("express");
const { pool, transaction, loadSettings } = require("../db");
const { authenticate, allowRoles } = require("../auth");
const { asyncHandler, fail, isUuid, isObject } = require("../helpers");
const { readDescriptor, toVector } = require("../matching");
const { getEmployee, setFaceEnrolled } = require("../attendance");

const router = express.Router();
router.use(authenticate);

const MIN_SAMPLES = 3;
const MAX_SAMPLES = 10;

// Body: { descriptors: [[128 numbers], [128 numbers], ...] } with 3-10 samples.
function readEnrollment(body) {
  if (!isObject(body) || Object.keys(body).some((key) => key !== "descriptors")) {
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

function readEmployeeId(req) {
  if (!isUuid(req.params.id)) {
    fail(400, "Employee id must be a valid UUID.");
  }
  return req.params.id;
}

// GET /api/recognition/employees/:id/faces: how many samples are saved.
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

// PUT /api/recognition/employees/:id/faces (admins only)
// Saves 3-10 samples and replaces any old ones for this employee.
router.put(
  "/:id/faces",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const employeeId = readEmployeeId(req);
    const vectors = readEnrollment(req.body).map(toVector);
    const organizationId = req.user.organization_id;

    const employee = await getEmployee(req.get("Authorization"), employeeId);

    if (employee.status !== "active") {
      fail(409, "Only active employees can be enrolled.");
    }

    // The same person must not be enrolled as two employees, otherwise one
    // person could mark attendance for someone else ("buddy punching").
    // <-> is pgvector's distance operator.
    const settings = await loadSettings(organizationId);
    const nearest = await pool.query(
      `SELECT MIN(f.embedding <-> s.v::vector) AS distance
       FROM unnest($2::text[]) AS s(v)
       JOIN recognition.face_embeddings f
         ON f.organization_id = $1 AND f.employee_id <> $3`,
      [organizationId, vectors, employeeId]
    );

    const distance = nearest.rows[0].distance;
    if (distance !== null && distance <= settings.match_threshold) {
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
        [organizationId, employeeId, vectors]
      );

      // Tell Attendance the employee now has a face. If that fails, the
      // error rolls back the transaction, so the samples are not saved.
      await setFaceEnrolled(organizationId, employeeId, true);
    });

    res.json({ employee_id: employeeId, samples: vectors.length, face_enrolled: true });
  })
);

// DELETE /api/recognition/employees/:id/faces (admins only): removes all samples.
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

module.exports = { router, readEnrollment };
