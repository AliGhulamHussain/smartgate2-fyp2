const test = require("node:test");
const assert = require("node:assert/strict");
const { readEmployee } = require("../utils");

const is400 = (error) => error.status === 400;

test("readEmployee trims, normalizes and keeps only supplied fields", () => {
  assert.deepEqual(
    readEmployee({
      employee_code: " EMP-001 ",
      full_name: " Ali Khan ",
      email: "Ali@Example.COM",
      phone: "+92 300-1234567",
      department: "",
    }),
    {
      employee_code: "EMP-001",
      full_name: "Ali Khan",
      email: "ali@example.com",
      phone: "+92 300-1234567",
      department: null,
    }
  );
});

test("readEmployee requires employee_code and full_name on create", () => {
  assert.throws(() => readEmployee({ full_name: "A" }), is400);
  assert.throws(() => readEmployee({ employee_code: "E1" }), is400);
  assert.throws(() => readEmployee({ employee_code: "  ", full_name: "A" }), is400);
});

test("readEmployee rejects unsupported and owned-elsewhere fields", () => {
  const base = { employee_code: "E1", full_name: "A" };
  assert.throws(() => readEmployee({ ...base, presence: "inside" }), is400);
  assert.throws(() => readEmployee({ ...base, face_enrolled: true }), is400);
  assert.throws(() => readEmployee({ ...base, organization_id: "x" }), is400);
  // status is only accepted on update.
  assert.throws(() => readEmployee({ ...base, status: "inactive" }), is400);
});

test("readEmployee validates formats and lengths", () => {
  const base = { employee_code: "E1", full_name: "A" };
  assert.throws(() => readEmployee({ ...base, email: "not-an-email" }), is400);
  assert.throws(() => readEmployee({ ...base, phone: "abc" }), is400);
  assert.throws(() => readEmployee({ ...base, employee_code: "bad code" }), is400);
  assert.throws(() => readEmployee({ ...base, full_name: "x".repeat(101) }), is400);
  assert.throws(() => readEmployee({ ...base, department: 5 }), is400);
  assert.throws(() => readEmployee([]), is400);
});

test("readEmployee partial mode allows status and clearing optional fields", () => {
  assert.deepEqual(readEmployee({ status: "inactive", email: null }, { partial: true }), {
    email: null,
    status: "inactive",
  });
  assert.throws(() => readEmployee({}, { partial: true }), is400);
  assert.throws(() => readEmployee({ status: "fired" }, { partial: true }), is400);
  assert.throws(() => readEmployee({ full_name: null }, { partial: true }), is400);
});
