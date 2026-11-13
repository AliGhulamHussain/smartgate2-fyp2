const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

for (const name of [
  "RECOGNITION_DATABASE_URL",
  "AUTH_SERVICE_URL",
  "ATTENDANCE_SERVICE_URL",
  "FRONTEND_ORIGIN",
  "INTERNAL_SERVICE_KEY",
]) {
  if (!process.env[name]) {
    throw new Error(`${name} is required.`);
  }
}

if (process.env.INTERNAL_SERVICE_KEY.length < 32) {
  throw new Error("INTERNAL_SERVICE_KEY must be at least 32 characters.");
}

const express = require("express");
const cors = require("cors");
const { pool } = require("./db");
const { connectRedis, closeRedis } = require("./events");
const { asyncHandler } = require("./utils");
const faceRoutes = require("./routes/faces");
const identifyRoutes = require("./routes/identify");
const settingsRoutes = require("./routes/settings");

const app = express();

app.disable("x-powered-by");

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
  })
);

app.use((req, res, next) => {
  const origin = req.get("Origin");

  if (origin && origin !== process.env.FRONTEND_ORIGIN) {
    return res.status(403).json({ message: "Origin is not allowed." });
  }

  next();
});

// Enrollment descriptors and a 200 KB base64 snapshot fit in 512kb.
app.use(express.json({ limit: "512kb" }));

app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get(
  "/health",
  asyncHandler(async (req, res) => {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      service: "recognition-service",
      database: "connected",
    });
  })
);

app.use("/api/recognition/employees", faceRoutes);
app.use("/api/recognition/identify", identifyRoutes);
app.use("/api/recognition/settings", settingsRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found." });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.public) {
    return res.status(error.status).json({ message: error.message });
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON body." });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large." });
  }

  console.error("Recognition error:", error.code || error.name);
  res.status(500).json({ message: "Internal server error." });
});

async function start() {
  await pool.query("SELECT 1");
  connectRedis();

  const port = Number(process.env.RECOGNITION_PORT || 4003);
  const host = process.env.RECOGNITION_HOST || "127.0.0.1";

  const server = app.listen(port, host, () => {
    console.log(`Recognition service running at http://${host}:${port}`);
  });

  function shutdown() {
    server.close(async () => {
      closeRedis();
      await pool.end();
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error("Recognition service failed to start:", error.message);
  process.exit(1);
});
