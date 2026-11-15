// Recognition settings for an organization:
//   match_threshold   how close a face must be to count as a match (0.2-0.8,
//                     lower = stricter)
//   liveness_required whether the kiosk must pass the blink check first
const express = require("express");
const { pool, loadSettings } = require("../db");
const { authenticate, allowRoles } = require("../auth");
const { asyncHandler, fail, isObject } = require("../helpers");

const router = express.Router();
router.use(authenticate);

// Both fields must be sent, and nothing else.
function readSettings(body) {
  const keys = isObject(body) ? Object.keys(body) : [];

  if (keys.length !== 2 || !keys.includes("match_threshold") || !keys.includes("liveness_required")) {
    fail(400, "Provide match_threshold and liveness_required only.");
  }

  const threshold = body.match_threshold;
  if (typeof threshold !== "number" || !(threshold >= 0.2 && threshold <= 0.8)) {
    fail(400, "match_threshold must be a number from 0.2 to 0.8.");
  }

  if (typeof body.liveness_required !== "boolean") {
    fail(400, "liveness_required must be true or false.");
  }

  return { match_threshold: threshold, liveness_required: body.liveness_required };
}

// GET /api/recognition/settings
router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ settings: await loadSettings(req.user.organization_id) });
  })
);

// PUT /api/recognition/settings (admins only)
router.put(
  "/",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const settings = readSettings(req.body);

    await pool.query(
      `INSERT INTO recognition.org_settings
         (organization_id, match_threshold, liveness_required, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (organization_id) DO UPDATE SET
         match_threshold = EXCLUDED.match_threshold,
         liveness_required = EXCLUDED.liveness_required,
         updated_at = NOW()`,
      [req.user.organization_id, settings.match_threshold, settings.liveness_required]
    );

    res.json({ settings: await loadSettings(req.user.organization_id) });
  })
);

module.exports = { router, readSettings };
