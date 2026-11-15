// Attendance service: policy, employees, gates, check-in/check-out and reports.
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

// Stop early with a clear message if a setting is missing.
for (const name of [
  "ATTENDANCE_DATABASE_URL",
  "AUTH_SERVICE_URL",
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
const { pool, closeOpenSessions } = require("./db");
const { asyncHandler } = require("./helpers");

const app = express();
app.disable("x-powered-by");

app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));

// Browsers may only call us from the SmartGate frontend.
app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin && origin !== process.env.FRONTEND_ORIGIN) {
    return res.status(403).json({ message: "Origin is not allowed." });
  }
  next();
});

app.use(express.json({ limit: "16kb" }));

app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get(
  "/health",
  asyncHandler(async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "attendance-service", database: "connected" });
  })
);

app.use("/api/attendance/policy", require("./routes/policy").router);
app.use("/api/attendance/employees", require("./routes/employees").router);
app.use("/api/attendance/gates", require("./routes/gates").router);
app.use("/api/attendance", require("./routes/monitoring").router); // presence, logs, daily, stats
app.use("/internal", require("./routes/internal").router); // only for other services

app.use((req, res) => {
  res.status(404).json({ message: "Route not found." });
});

// Errors thrown with fail() are sent to the client as they are. Anything
// else is logged and answered with a plain 500, so no details leak.
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

  console.error("Attendance error:", error.code || error.name);
  res.status(500).json({ message: "Internal server error." });
});

async function start() {
  await pool.query("SELECT 1"); // fail fast if the database is down

  const port = Number(process.env.ATTENDANCE_PORT || 4002);
  const host = process.env.ATTENDANCE_HOST || "127.0.0.1";

  const server = app.listen(port, host, () => {
    console.log(`Attendance service running at http://${host}:${port}`);
  });

  // Every minute, check out people who forgot to check out (see db.js).
  const autoClose = setInterval(() => {
    closeOpenSessions(pool).catch((error) => {
      console.error("Auto-close failed:", error.code || error.message);
    });
  }, 60 * 1000);

  function shutdown() {
    clearInterval(autoClose);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error("Attendance service failed to start:", error.message);
  process.exit(1);
});
