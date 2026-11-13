const test = require("node:test");
const assert = require("node:assert/strict");
const {
  readPunch,
  decideAction,
  checkInStatus,
  checkOutStatus,
} = require("../utils");

const ORG = "11111111-1111-4111-8111-111111111111";
const EMP = "22222222-2222-4222-8222-222222222222";
const GATE = "33333333-3333-4333-8333-333333333333";
const is400 = (error) => error.status === 400;

test("readPunch accepts a valid punch and defaults confidence to null", () => {
  assert.deepEqual(readPunch({ organization_id: ORG, employee_id: EMP, gate_id: GATE }), {
    organization_id: ORG,
    employee_id: EMP,
    gate_id: GATE,
    confidence: null,
  });
  assert.equal(
    readPunch({ organization_id: ORG, employee_id: EMP, gate_id: GATE, confidence: 0.91 }).confidence,
    0.91
  );
});

test("readPunch rejects bad input", () => {
  const base = { organization_id: ORG, employee_id: EMP, gate_id: GATE };
  assert.throws(() => readPunch({ ...base, gate_id: undefined }), is400);
  assert.throws(() => readPunch({ ...base, employee_id: "nope" }), is400);
  assert.throws(() => readPunch({ ...base, confidence: 1.5 }), is400);
  assert.throws(() => readPunch({ ...base, confidence: "0.9" }), is400);
  assert.throws(() => readPunch({ ...base, action: "check_in" }), is400);
  assert.throws(() => readPunch(null), is400);
});

test("decideAction follows gate direction and presence", () => {
  assert.equal(decideAction("entry", "outside"), "check_in");
  assert.equal(decideAction("entry", "inside"), null);
  assert.equal(decideAction("exit", "inside"), "check_out");
  assert.equal(decideAction("exit", "outside"), null);
  assert.equal(decideAction("both", "outside"), "check_in");
  assert.equal(decideAction("both", "inside"), "check_out");
});

test("checkInStatus applies grace minutes to the first check-in only", () => {
  const base = { workStart: "09:00:00", graceMinutes: 10, workingDay: true, firstToday: true };
  assert.deepEqual(checkInStatus({ ...base, localTime: "08:55:00" }), { status: "on_time", late_by_minutes: 0 });
  assert.deepEqual(checkInStatus({ ...base, localTime: "09:10:00" }), { status: "on_time", late_by_minutes: 0 });
  assert.deepEqual(checkInStatus({ ...base, localTime: "09:10:01.5" }), { status: "late", late_by_minutes: 10 });
  assert.deepEqual(checkInStatus({ ...base, localTime: "09:25:30" }), { status: "late", late_by_minutes: 25 });
  // Weekends and holidays are never late.
  assert.deepEqual(checkInStatus({ ...base, localTime: "11:00:00", workingDay: false }), { status: "on_time", late_by_minutes: 0 });
  // Re-entry after lunch is not judged.
  assert.deepEqual(checkInStatus({ ...base, localTime: "14:00:00", firstToday: false }), { status: "normal", late_by_minutes: 0 });
});

test("checkOutStatus flags leaving before work_end on working days", () => {
  assert.equal(checkOutStatus({ localTime: "16:59:59", workEnd: "17:00:00", workingDay: true }), "early_leave");
  assert.equal(checkOutStatus({ localTime: "17:00:00", workEnd: "17:00:00", workingDay: true }), "normal");
  assert.equal(checkOutStatus({ localTime: "12:00:00", workEnd: "17:00:00", workingDay: false }), "normal");
});
