const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

for (const name of [
  "AUTH_SERVICE_URL",
  "ATTENDANCE_SERVICE_URL",
  "FRONTEND_ORIGIN",
]) {
  if (!process.env[name]) {
    throw new Error(`${name} is required.`);
  }
}

const express = require("express");
const cors = require("cors");
const apiRoutes = require("./routes/api");

const app = express();

app.disable("x-powered-by");

// Check browser origins.
app.use((req, res, next) => {
  const origin = req.get("Origin");

  if (origin && origin !== process.env.FRONTEND_ORIGIN) {
    return res.status(403).json({
      message: "Origin is not allowed.",
    });
  }

  next();
});

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
  })
);

app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("X-SmartGate-Gateway", "true");

  // Remove identity headers supplied by clients.
  for (const header of [
    "x-user-id",
    "x-organization-id",
    "x-user-role",
    "x-internal-token",
  ]) {
    delete req.headers[header];
  }

  next();
});

// Request bodies pass directly to the services.
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "api-gateway",
  });
});

app.use(apiRoutes);

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found.",
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error("Gateway error:", error.code || error.name);

  res.status(500).json({
    message: "Internal server error.",
  });
});

const port = Number(process.env.GATEWAY_PORT || 4000);
const host = process.env.GATEWAY_HOST || "127.0.0.1";

const server = app.listen(port, host, () => {
  console.log(`API gateway running at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
