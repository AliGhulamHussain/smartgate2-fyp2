const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validUuid,
  uuidFromText,
  readUnknownFaceEvent,
  readReview,
  readRecipient,
} = require("../utils");

const ORG = "11111111-1111-4111-8111-111111111111";
const GATE = "33333333-3333-4333-8333-333333333333";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]).toString("base64");
const is400 = (error) => error.status === 400;

const event = {
  organization_id: ORG,
  gate_id: GATE,
  best_distance: "0.71",
  recognition_event_id: GATE,
  captured_at: "2026-11-13T10:00:00.000Z",
  snapshot: JPEG,
};

test("uuidFromText is stable and UUID-shaped", () => {
  assert.equal(uuidFromText("a"), uuidFromText("a"));
  assert.notEqual(uuidFromText("a"), uuidFromText("b"));
  assert.ok(validUuid(uuidFromText("smartgate:unknown-faces:1-0")));
});

test("readUnknownFaceEvent parses stream fields", () => {
  const parsed = readUnknownFaceEvent(event);
  assert.equal(parsed.best_distance, 0.71);
  assert.equal(parsed.snapshot[0], 0xff);
  assert.equal(readUnknownFaceEvent({ ...event, best_distance: "" }).best_distance, null);
});

test("readUnknownFaceEvent rejects bad stream fields", () => {
  assert.throws(() => readUnknownFaceEvent({ ...event, organization_id: "x" }), is400);
  assert.throws(() => readUnknownFaceEvent({ ...event, gate_id: undefined }), is400);
  assert.throws(() => readUnknownFaceEvent({ ...event, best_distance: "far" }), is400);
  assert.throws(() => readUnknownFaceEvent({ ...event, captured_at: "yesterday" }), is400);
  assert.throws(() => readUnknownFaceEvent({ ...event, snapshot: Buffer.from("PNG!").toString("base64") }), is400);
  assert.throws(() => readUnknownFaceEvent({ ...event, snapshot: "not base64!" }), is400);
});

test("readReview validates status and note", () => {
  assert.deepEqual(readReview({ status: "reviewed", note: " visitor " }), { status: "reviewed", note: "visitor" });
  assert.deepEqual(readReview({ status: "dismissed" }), { status: "dismissed", note: null });
  assert.throws(() => readReview({ status: "deleted" }), is400);
  assert.throws(() => readReview({ status: "reviewed", note: "x".repeat(501) }), is400);
  assert.throws(() => readReview({ status: "reviewed", reviewed_by: ORG }), is400);
});

test("readRecipient validates email and alert types", () => {
  assert.deepEqual(readRecipient({ email: " Admin@School.EDU ", alert_types: ["unknown_face"] }), {
    email: "admin@school.edu",
    alert_types: ["unknown_face"],
  });
  assert.equal(readRecipient({ email: "a@b.co" }).alert_types.length, 4);
  assert.throws(() => readRecipient({ email: "nope" }), is400);
  assert.throws(() => readRecipient({ email: "a@b.co", alert_types: ["sms"] }), is400);
  assert.throws(() => readRecipient({ email: "a@b.co", alert_types: [] }), is400);
});
