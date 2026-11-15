const test = require("node:test");
const assert = require("node:assert/strict");
const { readGate } = require("../routes/gates");

const is400 = (error) => error.status === 400;

test("readGate trims name and keeps optional direction", () => {
  assert.deepEqual(readGate({ name: " Main Gate " }), { name: "Main Gate" });
  assert.deepEqual(readGate({ name: "Back", direction: "exit" }), {
    name: "Back",
    direction: "exit",
  });
});

test("readGate validates create input", () => {
  assert.throws(() => readGate({}), is400);
  assert.throws(() => readGate({ name: "   " }), is400);
  assert.throws(() => readGate({ name: "x".repeat(81) }), is400);
  assert.throws(() => readGate({ name: "A", direction: "sideways" }), is400);
  assert.throws(() => readGate({ name: "A", organization_id: "x" }), is400);
  // status is only accepted on update.
  assert.throws(() => readGate({ name: "A", status: "inactive" }), is400);
  assert.throws(() => readGate(null), is400);
});

test("readGate partial mode allows status and rejects empty updates", () => {
  assert.deepEqual(readGate({ status: "inactive" }, { partial: true }), {
    status: "inactive",
  });
  assert.throws(() => readGate({}, { partial: true }), is400);
  assert.throws(() => readGate({ status: "closed" }, { partial: true }), is400);
  assert.throws(() => readGate({ name: null }, { partial: true }), is400);
});
