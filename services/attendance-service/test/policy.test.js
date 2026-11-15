const test = require("node:test");
const assert = require("node:assert/strict");
const { readPolicy } = require("../routes/policy");

const validPolicy = {
  timezone: "Asia/Karachi",
  work_start: "09:00",
  work_end: "17:00",
  grace_minutes: 10,
  working_days: [5, 1, 3, 2, 4],
  auto_close_time: "23:30",
};

test("readPolicy validates and normalizes a complete policy", () => {
  assert.deepEqual(readPolicy(validPolicy), {
    timezone: "Asia/Karachi",
    work_start: "09:00:00",
    work_end: "17:00:00",
    grace_minutes: 10,
    working_days: [1, 2, 3, 4, 5],
    auto_close_time: "23:30:00",
  });
});

test("readPolicy rejects missing or unsupported fields", () => {
  assert.throws(
    () => readPolicy({ ...validPolicy, work_end: undefined }),
    (error) => error.status === 400
  );

  assert.throws(
    () => readPolicy({ ...validPolicy, extra: true }),
    (error) => error.status === 400
  );
});

test("readPolicy rejects invalid policy values", () => {
  for (const policy of [
    { ...validPolicy, timezone: "Not/A-Timezone" },
    { ...validPolicy, work_start: "25:00" },
    { ...validPolicy, work_end: "09:00" },
    { ...validPolicy, grace_minutes: -1 },
    { ...validPolicy, working_days: [1, 1, 2] },
    { ...validPolicy, working_days: [0, 1, 2] },
  ]) {
    assert.throws(
      () => readPolicy(policy),
      (error) => error.status === 400
    );
  }
});
