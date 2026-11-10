const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

const authProxy = createProxyMiddleware({
  target: process.env.AUTH_SERVICE_URL,
  changeOrigin: true,

  // Keep the complete path and query string.
  pathRewrite: (path, req) => req.originalUrl,

  proxyTimeout: 10000,
  timeout: 15000,

  on: {
    error: (error, req, res) => {
      console.error("Auth proxy failed:", error.code || error.name);

      if (res.headersSent) {
        res.destroy();
        return;
      }

      res.status(502).json({
        message: "Could not reach the Auth service.",
      });
    },
  },
});

// Public routes.
router.post("/api/auth/signup", authProxy);
router.post("/api/auth/login", authProxy);
router.post("/api/auth/refresh", authProxy);
router.post("/api/auth/logout", authProxy);

// Authentication already fetched the current user.
router.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Auth also checks roles and organization access.
router.get("/api/users", authenticate, authProxy);
router.post("/api/users", authenticate, authProxy);
router.patch("/api/users/:id", authenticate, authProxy);

module.exports = router;