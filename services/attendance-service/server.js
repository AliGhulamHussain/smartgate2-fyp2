const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

for (const name of [
  "ATTENDANCE_DATABASE_URL",
  "AUTH_SERVICE_URL",
  "FRONTEND_ORIGIN",
]) {
  if (!process.env[name]) {
    throw new Error(`${name} is required.`);
  }
}

const express = require("express");
const cors = require("cors");
const { pool } = require("./db");
const { asyncHandler } = require("./utils");
const policyRoutes = require("./routes/policy");
const employeeRoutes = require("./routes/employees");
const gateRoutes = require("./routes/gates");

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

app.use(express.json({ limit: "16kb" }));

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
      service: "attendance-service",
      database: "connected",
    });
  })
);

app.use("/api/attendance/policy", policyRoutes);
app.use("/api/attendance/employees", employeeRoutes);
app.use("/api/attendance/gates", gateRoutes);

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

  console.error("Attendance error:", error.code || error.name);
  res.status(500).json({ message: "Internal server error." });
});

async function start() {
  await pool.query("SELECT 1");

  const port = Number(process.env.ATTENDANCE_PORT || 4002);
  const host = process.env.ATTENDANCE_HOST || "127.0.0.1";

  const server = app.listen(port, host, () => {
    console.log(`Attendance service running at http://${host}:${port}`);
  });

  function shutdown() {
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
