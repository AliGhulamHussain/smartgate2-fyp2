// Reads unknown-face events from the Redis Stream written by the
// Recognition Service and turns them into alerts and queued notifications.
const fs = require("fs/promises");
const path = require("path");
const { createClient } = require("redis");
const { transaction } = require("./db");
const { uuidFromText, readUnknownFaceEvent } = require("./utils");

// Shared with services/recognition-service/events.js.
const STREAM = "smartgate:unknown-faces";
const GROUP = "alerts-service";
const CONSUMER = `alerts-${process.pid}`;

// Snapshots live on disk; the database keeps only the relative path.
const SNAPSHOT_DIR = path.resolve(
  process.env.ALERTS_SNAPSHOT_DIR || path.join(__dirname, "snapshots")
);

const client = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
let running = false;

client.on("error", (error) => {
  console.error("Redis error:", error.code || error.message);
});

async function saveAlert(messageId, fields) {
  const event = readUnknownFaceEvent(fields);

  // Same message id -> same alert id, so a retry cannot duplicate it.
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
      [alertId, event.organization_id, event.gate_id, relativePath,
        event.best_distance, event.captured_at]
    );

    if (!inserted.rows[0]) {
      return;
    }

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

// Handles one batch. Bad messages are logged and acknowledged (dropped);
// messages that fail for other reasons (e.g. database down) stay pending
// and are retried on the next start.
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

  try {
    await client.xGroupCreate(STREAM, GROUP, "0", { MKSTREAM: true });
  } catch (error) {
    if (!String(error.message).startsWith("BUSYGROUP")) throw error;
  }

  running = true;

  // First retry this consumer's pending messages from a previous run.
  // ponytail: retried only at startup and never dead-lettered; add
  // XAUTOCLAIM plus a delivery-count limit if failures become common.
  await handleBatch(
    await client.xReadGroup(GROUP, CONSUMER, { key: STREAM, id: "0" }, { COUNT: 100 })
  );

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

module.exports = { startConsumer, stopConsumer, SNAPSHOT_DIR, STREAM, GROUP };
