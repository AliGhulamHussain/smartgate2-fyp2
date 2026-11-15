// Turns unknown-face events into alerts.
//
// The Recognition service writes each unknown face (with its photo) to the
// Redis Stream "smartgate:unknown-faces". This file reads that stream as the
// consumer group "alerts-service". For each event it saves the photo to
// disk, adds a row to alerts.unknown_faces, and queues a notification for
// every recipient who wants unknown-face alerts.
//
// Why a stream and not a direct HTTP call? If Alerts is down, events wait in
// Redis and are processed when it comes back, and the kiosk never waits.
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { createClient } = require("redis");
const { transaction } = require("./db");
const { fail, isUuid } = require("./helpers");

// Shared with services/recognition-service/events.js.
const STREAM = "smartgate:unknown-faces";
const GROUP = "alerts-service";
const CONSUMER = `alerts-${process.pid}`;

// Photos are kept on disk; the database only stores the relative path.
const SNAPSHOT_DIR = path.resolve(
  process.env.ALERTS_SNAPSHOT_DIR || path.join(__dirname, "snapshots")
);

const client = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
let running = false;

client.on("error", (error) => {
  console.error("Redis error:", error.code || error.message);
});

// The same text always gives the same UUID. We use it to turn the stream
// message id into the alert id, so processing a message twice can never
// create two alerts.
function uuidFromText(text) {
  const hex = crypto.createHash("sha256").update(text).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

// Checks one stream message (every field arrives as text) and returns the
// event with the JPEG photo decoded to bytes.
function readUnknownFaceEvent(fields) {
  if (!isUuid(fields.organization_id)) {
    fail(400, "organization_id is invalid.");
  }
  if (!isUuid(fields.gate_id)) {
    fail(400, "gate_id is invalid.");
  }

  const bestDistance = fields.best_distance === "" ? null : Number(fields.best_distance);
  if (bestDistance !== null && !Number.isFinite(bestDistance)) {
    fail(400, "best_distance is invalid.");
  }

  if (typeof fields.captured_at !== "string" || Number.isNaN(Date.parse(fields.captured_at))) {
    fail(400, "captured_at is invalid.");
  }

  const snapshot =
    typeof fields.snapshot === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(fields.snapshot)
      ? Buffer.from(fields.snapshot, "base64")
      : Buffer.alloc(0);

  // Every JPEG file starts with the bytes FF D8 FF.
  if (snapshot.length < 4 || snapshot[0] !== 0xff || snapshot[1] !== 0xd8 || snapshot[2] !== 0xff) {
    fail(400, "snapshot is not a JPEG image.");
  }

  return {
    organization_id: fields.organization_id,
    gate_id: fields.gate_id,
    best_distance: bestDistance,
    recognition_event_id: isUuid(fields.recognition_event_id) ? fields.recognition_event_id : null,
    captured_at: new Date(fields.captured_at).toISOString(),
    snapshot,
  };
}

async function saveAlert(messageId, fields) {
  const event = readUnknownFaceEvent(fields);

  const alertId = uuidFromText(`${STREAM}:${messageId}`);
  const relativePath = `${event.organization_id}/${alertId}.jpg`;

  await fs.mkdir(path.join(SNAPSHOT_DIR, event.organization_id), { recursive: true });
  await fs.writeFile(path.join(SNAPSHOT_DIR, relativePath), event.snapshot);

  await transaction(async (db) => {
    const inserted = await db.query(
      `INSERT INTO alerts.unknown_faces
         (id, organization_id, gate_id, snapshot_path, best_distance, captured_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [alertId, event.organization_id, event.gate_id, relativePath, event.best_distance, event.captured_at]
    );

    // Already saved before (a retry): don't queue the notifications again.
    if (!inserted.rows[0]) {
      return;
    }

    // One notification per recipient subscribed to unknown_face.
    // ponytail: notifications stay "queued"; add an SMTP sender
    // (e.g. nodemailer) that marks them sent/failed when email is needed.
    await db.query(
      `INSERT INTO alerts.notifications
         (organization_id, type, recipient, subject, payload)
       SELECT organization_id, 'unknown_face', email,
              'Unknown face detected at a gate',
              jsonb_build_object('unknown_face_id', $2::uuid, 'gate_id', $3::uuid,
                                 'captured_at', $4::timestamptz)
       FROM alerts.notification_recipients
       WHERE organization_id = $1 AND 'unknown_face' = ANY(alert_types)`,
      [event.organization_id, alertId, event.gate_id, event.captured_at]
    );
  });
}

// Handles a batch of messages. A message is acknowledged (removed from our
// pending list) when it was saved, or when it is broken and can never be
// saved. Any other failure (e.g. database down) leaves it pending, and it is
// tried again on the next start.
async function handleBatch(result) {
  for (const { id, message } of result?.[0]?.messages ?? []) {
    try {
      await saveAlert(id, message);
      await client.xAck(STREAM, GROUP, id);
    } catch (error) {
      if (error.public) {
        console.error(`Dropped invalid unknown-face event ${id}:`, error.message);
        await client.xAck(STREAM, GROUP, id);
      } else {
        console.error(`Unknown-face event ${id} failed, will retry:`, error.code || error.message);
      }
    }
  }
}

async function startConsumer() {
  await client.connect();

  // Create the consumer group the first time (BUSYGROUP = it already exists).
  try {
    await client.xGroupCreate(STREAM, GROUP, "0", { MKSTREAM: true });
  } catch (error) {
    if (!String(error.message).startsWith("BUSYGROUP")) throw error;
  }

  running = true;

  // First, retry messages left pending by a previous run (id "0").
  // ponytail: retried only at startup and never dead-lettered; add
  // XAUTOCLAIM plus a delivery-count limit if failures become common.
  await handleBatch(
    await client.xReadGroup(GROUP, CONSUMER, { key: STREAM, id: "0" }, { COUNT: 100 })
  );

  // Then wait for new messages (id ">"), up to 5 seconds per read.
  (async () => {
    while (running) {
      try {
        const result = await client.xReadGroup(
          GROUP,
          CONSUMER,
          { key: STREAM, id: ">" },
          { COUNT: 10, BLOCK: 5000 }
        );
        await handleBatch(result);
      } catch (error) {
        if (!running) break;
        console.error("Stream read failed:", error.code || error.message);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  })();
}

function stopConsumer() {
  running = false;
  if (client.isOpen) {
    client.destroy();
  }
}

module.exports = {
  startConsumer,
  stopConsumer,
  SNAPSHOT_DIR,
  uuidFromText,
  readUnknownFaceEvent,
};
