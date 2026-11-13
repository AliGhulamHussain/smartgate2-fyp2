// Email addresses that receive alert notifications. Admin only.
const express = require("express");
const { pool, transaction, audit } = require("../db");
const {
  authenticate,
  requireOrganization,
  allowRoles,
} = require("../middleware/auth");
const { asyncHandler, fail, validUuid, readRecipient } = require("../utils");

const router = express.Router();

router.use(authenticate, requireOrganization, allowRoles("org_admin"));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, email, alert_types
       FROM alerts.notification_recipients
       WHERE organization_id = $1
       ORDER BY email`,
      [req.user.organization_id]
    );

    res.json({ recipients: result.rows });
  })
);

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

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!validUuid(req.params.id)) {
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

module.exports = router;
