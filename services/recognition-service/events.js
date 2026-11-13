// Publishes unknown-face events to the Alerts Service through a Redis Stream.
// Redis being down must never break identification, so every failure here
// is logged and reported as "not queued".
const { createClient } = require("redis");

// Shared with services/alerts-service/consumer.js.
const STREAM = "smartgate:unknown-faces";

// One unknown-face alert per gate per this many seconds, so a stranger
// standing in front of the camera does not create dozens of alerts.
const COOLDOWN_SECONDS = Number(process.env.UNKNOWN_FACE_COOLDOWN_SECONDS || 30);

if (!Number.isSafeInteger(COOLDOWN_SECONDS) || COOLDOWN_SECONDS < 0) {
  throw new Error("UNKNOWN_FACE_COOLDOWN_SECONDS must be a whole number of seconds.");
}

const client = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });

client.on("error", (error) => {
  console.error("Redis error:", error.code || error.message);
});

// Connect in the background; the service also works while Redis is down.
function connectRedis() {
  client.connect().catch(() => {});
}

// Returns true when the event was added to the stream.
async function publishUnknownFace(event) {
  if (!client.isReady) {
    return false;
  }

  try {
    if (COOLDOWN_SECONDS > 0) {
      const first = await client.set(
        `smartgate:unknown-cooldown:${event.organization_id}:${event.gate_id}`,
        "1",
        { NX: true, EX: COOLDOWN_SECONDS }
      );
      if (!first) {
        return false;
      }
    }

    await client.xAdd(
      STREAM,
      "*",
      {
        organization_id: event.organization_id,
        gate_id: event.gate_id,
        best_distance: event.best_distance === null ? "" : String(event.best_distance),
        recognition_event_id: event.recognition_event_id,
        captured_at: event.captured_at,
        snapshot: event.snapshot,
      },
      // Keep the stream bounded; acknowledged events are not needed later.
      { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: 10000 } }
    );

    return true;
  } catch (error) {
    console.error("Unknown-face publish failed:", error.code || error.message);
    return false;
  }
}

function closeRedis() {
  if (client.isOpen) {
    client.destroy();
  }
}

module.exports = { connectRedis, publishUnknownFace, closeRedis };
