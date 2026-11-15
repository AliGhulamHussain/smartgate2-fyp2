// Auth service: organizations, users, login sessions and roles.
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

// Stop early with a clear message if a setting is missing.
if (!process.env.AUTH_DATABASE_URL) {
  throw new Error("AUTH_DATABASE_URL is required.");
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters.");
}
if (!process.env.FRONTEND_ORIGIN) {
  throw new Error("FRONTEND_ORIGIN is required.");
}

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { rateLimit } = require("express-rate-limit");
const { pool } = require("./db");
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
app.use(cookieParser());

app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// At most 30 signup/login attempts per 15 minutes from one address,
// to slow down password guessing.
// ponytail: kept in memory, so it resets when the service restarts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many authentication attempts. Try again later." },
});
app.use(["/api/auth/signup", "/api/auth/login"], loginLimiter);

app.get(
  "/health",
  asyncHandler(async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "auth-service", database: "connected" });
  })
);

app.use("/api/auth", require("./routes/auth").router);
app.use("/api/users", require("./routes/users").router);

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
  // 23505 = a UNIQUE rule in the database was broken.
  if (error.code === "23505") {
    return res.status(409).json({ message: "Email or organization slug already exists." });
  }
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON body." });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large." });
  }

  console.error("Auth error:", error.code || error.name);
  res.status(500).json({ message: "Internal server error." });
});

async function start() {
  await pool.query("SELECT 1"); // fail fast if the database is down

  const port = Number(process.env.AUTH_PORT || 4001);
  const host = process.env.AUTH_HOST || "127.0.0.1";

  const server = app.listen(port, host, () => {
    console.log(`Auth service running at http://${host}:${port}`);
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
  console.error("Auth service failed to start:", error.message);
  process.exit(1);
});
