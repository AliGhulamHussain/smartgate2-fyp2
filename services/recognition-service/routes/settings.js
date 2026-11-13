const express = require("express");
const { pool, loadSettings } = require("../db");
const {
  authenticate,
  requireOrganization,
  allowRoles,
} = require("../middleware/auth");
const { asyncHandler, readSettings } = require("../utils");

const router = express.Router();

router.use(authenticate, requireOrganization);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ settings: await loadSettings(req.user.organization_id) });
  })
);

router.put(
  "/",
  allowRoles("org_admin"),
  asyncHandler(async (req, res) => {
    const settings = readSettings(req.body);

    await pool.query(
      `INSERT INTO recognition.org_settings
         (organization_id, match_threshold, liveness_required, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (organization_id)
       DO UPDATE SET match_threshold = EXCLUDED.match_threshold,
                     liveness_required = EXCLUDED.liveness_required,
                     updated_at = NOW()`,
      [req.user.organization_id, settings.match_threshold, settings.liveness_required]
    );

    res.json({ settings: await loadSettings(req.user.organization_id) });
  })
);

module.exports = router;
