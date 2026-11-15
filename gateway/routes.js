// The list of routes the browser may use, and which service handles each.
//
// Only routes listed here are forwarded. Anything else gets a 404, which is
// how the /internal routes (service-to-service only) stay hidden.
// Each service also checks roles and organization access itself.
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { authenticate } = require("./auth");

// Forwards requests to one service, keeping the full path, query and body.
// If the service cannot be reached the client gets a clear 502 message.
function proxyTo(serviceName, target) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (path, req) => req.originalUrl,
    proxyTimeout: 10000,
    timeout: 15000,
    on: {
      error: (error, req, res) => {
        console.error(`${serviceName} proxy failed:`, error.code || error.name);

        if (res.headersSent) {
          res.destroy();
          return;
        }
        res.status(502).json({ message: `Could not reach the ${serviceName} service.` });
      },
    },
  });
}

const auth = proxyTo("Auth", process.env.AUTH_SERVICE_URL);
const attendance = proxyTo("Attendance", process.env.ATTENDANCE_SERVICE_URL);
const recognition = proxyTo("Recognition", process.env.RECOGNITION_SERVICE_URL);
const alerts = proxyTo("Alerts", process.env.ALERTS_SERVICE_URL);

const router = express.Router();

// ---- Auth: public routes (no login needed yet) ----
router.post("/api/auth/signup", auth);
router.post("/api/auth/login", auth);
router.post("/api/auth/refresh", auth);
router.post("/api/auth/logout", auth);

// authenticate already loaded the user, so answer directly.
router.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ---- Everything below needs a valid login ----
router.get("/api/users", authenticate, auth);
router.post("/api/users", authenticate, auth);
router.patch("/api/users/:id", authenticate, auth);

router.get("/api/attendance/policy", authenticate, attendance);
router.put("/api/attendance/policy", authenticate, attendance);

router.get("/api/attendance/employees", authenticate, attendance);
router.post("/api/attendance/employees", authenticate, attendance);
router.get("/api/attendance/employees/:id", authenticate, attendance);
router.patch("/api/attendance/employees/:id", authenticate, attendance);

router.get("/api/attendance/gates", authenticate, attendance);
router.post("/api/attendance/gates", authenticate, attendance);
router.get("/api/attendance/gates/:id", authenticate, attendance);
router.patch("/api/attendance/gates/:id", authenticate, attendance);

router.get("/api/attendance/presence", authenticate, attendance);
router.get("/api/attendance/logs", authenticate, attendance);
router.get("/api/attendance/daily", authenticate, attendance);
router.get("/api/attendance/stats", authenticate, attendance);

router.get("/api/recognition/employees/:id/faces", authenticate, recognition);
router.put("/api/recognition/employees/:id/faces", authenticate, recognition);
router.delete("/api/recognition/employees/:id/faces", authenticate, recognition);
router.post("/api/recognition/identify", authenticate, recognition);
router.get("/api/recognition/settings", authenticate, recognition);
router.put("/api/recognition/settings", authenticate, recognition);

router.get("/api/alerts/unknown-faces", authenticate, alerts);
router.get("/api/alerts/unknown-faces/:id", authenticate, alerts);
router.get("/api/alerts/unknown-faces/:id/snapshot", authenticate, alerts);
router.patch("/api/alerts/unknown-faces/:id", authenticate, alerts);
router.get("/api/alerts/recipients", authenticate, alerts);
router.post("/api/alerts/recipients", authenticate, alerts);
router.delete("/api/alerts/recipients/:id", authenticate, alerts);
router.get("/api/alerts/notifications", authenticate, alerts);
router.get("/api/alerts/audit-logs", authenticate, alerts);

module.exports = router;
