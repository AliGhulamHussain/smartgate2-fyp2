const test = require("node:test");
const assert = require("node:assert/strict");
const { readDate, readChoice, readUuid, readPositiveInt } = require("../helpers");

const is400 = (error) => error.status === 400;

test("readDate accepts real YYYY-MM-DD dates only", () => {
  assert.equal(readDate(undefined, "d"), undefined);
  assert.equal(readDate("2026-11-13", "d"), "2026-11-13");
  assert.equal(readDate("2024-02-29", "d"), "2024-02-29");
  assert.throws(() => readDate("2026-02-30", "d"), is400);
  assert.throws(() => readDate("2026-13-01", "d"), is400);
  assert.throws(() => readDate("13/11/2026", "d"), is400);
  assert.throws(() => readDate(["2026-11-13"], "d"), is400);
});

test("readChoice, readUuid and readPositiveInt validate query values", () => {
  assert.equal(readChoice("late", "s", ["late", "absent"]), "late");
  assert.throws(() => readChoice("gone", "s", ["late"]), is400);
  assert.throws(() => readChoice(["late"], "s", ["late"]), is400);
  assert.throws(() => readUuid("abc", "id"), is400);
  assert.equal(readPositiveInt(undefined, "p", 1, 10), 1);
  assert.throws(() => readPositiveInt("0", "p", 1, 10), is400);
  assert.throws(() => readPositiveInt("1.5", "p", 1, 10), is400);
});
