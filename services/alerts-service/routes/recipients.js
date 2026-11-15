// Email addresses that receive alert notifications. Admins only.
// Adding and removing recipients is written to the audit log.
const express = require("express");
const { pool, transaction, audit } = require("../db");
const { authenticate, allowRoles } = require("../auth");
const { asyncHandler, fail, isUuid, isObject } = require("../helpers");

const router = express.Router();
router.use(authenticate, allowRoles("org_admin"));

const ALERT_TYPES = ["unknown_face", "late_arrival", "forgot_checkout", "daily_summary"];

// Body: { email, alert_types? }. Without alert_types the recipient gets all types.
function readRecipient(body) {
  if (!isObject(body) || Object.keys(body).some((key) => !["email", "alert_types"].includes(key))) {
    fail(400, "Body must be { email, alert_types? }.");
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, "email must be a valid email address.");
  }

  let alertTypes = ALERT_TYPES;
  if (body.alert_types !== undefined) {
    const types = body.alert_types;
    const valid =
      Array.isArray(types) &&
      types.length > 0 &&
      types.every((type) => ALERT_TYPES.includes(type)) &&
      new Set(types).size === types.length;

    if (!valid) {
      fail(400, `alert_types must be a non-empty list of: ${ALERT_TYPES.join(", ")}.`);
    }
    alertTypes = types;
  }

  return { email, alert_types: alertTypes };
}

// GET /api/alerts/recipients
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, email, alert_types FROM alerts.notification_recipients
       WHERE organization_id = $1
       ORDER BY email`,
      [req.user.organization_id]
    );

    res.json({ recipients: result.rows });
  })
);

// POST /api/alerts/recipients
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const recipient = readRecipient(req.body);

    const row = await transaction(async (db) => {
      const result = await db
        .query(
          `INSERT INTO alerts.notification_recipients (organization_id, email, alert_types)
           VALUES ($1, $2, $3)
           RETURNING id, email, alert_types`,
          [req.user.organization_id, recipient.email, recipient.alert_types]
        )
        .catch((error) => {
          // 23505 = a UNIQUE rule was broken (same email twice).
          if (error.code === "23505") fail(409, "This email is already a recipient.");
          throw error;
        });

      await audit(db, req, "recipient.added", "notification_recipient", result.rows[0].id,
        { email: recipient.email });
      return result.rows[0];
    });

    res.status(201).json({ recipient: row });
  })
);

// DELETE /api/alerts/recipients/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) {
      fail(400, "Recipient id must be a valid UUID.");
    }

    await transaction(async (db) => {
      const result = await db.query(
        `DELETE FROM alerts.notification_recipients
         WHERE id = $1 AND organization_id = $2
         RETURNING email`,
        [req.params.id, req.user.organization_id]
      );

      if (!result.rows[0]) {
        fail(404, "Recipient not found.");
      }

      await audit(db, req, "recipient.removed", "notification_recipient", req.params.id,
        { email: result.rows[0].email });
    });

    res.json({ message: "Recipient removed." });
  })
);

module.exports = { router, readRecipient };
