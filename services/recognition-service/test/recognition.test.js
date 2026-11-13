const test = require("node:test");
const assert = require("node:assert/strict");
const {
  readEnrollment,
  readIdentify,
  readSettings,
  toVector,
  decideMatch,
} = require("../utils");

const GATE = "33333333-3333-4333-8333-333333333333";
const sample = (value = 0.01) => Array(128).fill(value);
const is400 = (error) => error.status === 400;

test("readEnrollment requires 3-10 valid 128-number samples", () => {
  assert.equal(readEnrollment({ descriptors: [sample(), sample(), sample()] }).length, 3);
  assert.throws(() => readEnrollment({ descriptors: [sample(), sample()] }), is400);
  assert.throws(() => readEnrollment({ descriptors: Array(11).fill(sample()) }), is400);
  assert.throws(() => readEnrollment({ descriptors: [sample(), sample(), sample().slice(1)] }), is400);
  assert.throws(() => readEnrollment({ descriptors: [sample(), sample(), [...sample().slice(1), "x"]] }), is400);
  assert.throws(() => readEnrollment({ descriptors: [sample(), sample(), [...sample().slice(1), NaN]] }), is400);
  assert.throws(() => readEnrollment({ descriptors: [sample(), sample(), sample()], extra: 1 }), is400);
});

test("readIdentify validates gate, descriptor and liveness flag", () => {
  assert.deepEqual(readIdentify({ gate_id: GATE, descriptor: sample() }).liveness_passed, false);
  assert.equal(readIdentify({ gate_id: GATE, descriptor: sample(), liveness_passed: true }).liveness_passed, true);
  assert.throws(() => readIdentify({ gate_id: "x", descriptor: sample() }), is400);
  assert.throws(() => readIdentify({ gate_id: GATE, descriptor: [1, 2] }), is400);
  assert.throws(() => readIdentify({ gate_id: GATE, descriptor: sample(), liveness_passed: "yes" }), is400);
  assert.throws(() => readIdentify({ gate_id: GATE, descriptor: sample(), employee_id: GATE }), is400);
});

test("readSettings bounds the threshold", () => {
  assert.deepEqual(readSettings({ match_threshold: 0.45, liveness_required: false }), {
    match_threshold: 0.45,
    liveness_required: false,
  });
  assert.throws(() => readSettings({ match_threshold: 0.9, liveness_required: true }), is400);
  assert.throws(() => readSettings({ match_threshold: "0.5", liveness_required: true }), is400);
  assert.throws(() => readSettings({ match_threshold: 0.5 }), is400);
});

test("toVector produces pgvector text", () => {
  assert.equal(toVector([0.5, -1, 2]), "[0.5,-1,2]");
});

test("decideMatch applies threshold and margin", () => {
  const A = "a", B = "b";
  assert.deepEqual(decideMatch([], 0.5, 0.05), { matched: false, reason: "no_enrolled_faces" });
  assert.deepEqual(decideMatch([{ employee_id: A, distance: 0.3 }], 0.5, 0.05), {
    matched: true, employee_id: A, distance: 0.3,
  });
  assert.equal(decideMatch([{ employee_id: A, distance: 0.55 }], 0.5, 0.05).reason, "no_match");
  assert.equal(
    decideMatch([{ employee_id: A, distance: 0.3 }, { employee_id: B, distance: 0.33 }], 0.5, 0.05).reason,
    "ambiguous"
  );
  assert.equal(
    decideMatch([{ employee_id: A, distance: 0.3 }, { employee_id: B, distance: 0.6 }], 0.5, 0.05).matched,
    true
  );
});
