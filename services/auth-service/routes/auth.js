const express = require("express");
const bcrypt = require("bcryptjs");
const { pool, transaction } = require("../db");
const { authenticate } = require("../middleware/auth");
const {
  asyncHandler,
  fail,
  text,
  normalizeEmail,
  validPassword,
  checkAccount,
  hashToken,
  readRefreshToken,
  createSession,
  sendSession,
  clearRefreshCookie,
} = require("../utils");

const router = express.Router();

// Create an organization and its first admin.
router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    const organizationName = text(body.organization_name, 150);
    const slug = text(body.organization_slug, 60)?.toLowerCase();
    const fullName = text(body.full_name, 100);
    const email = normalizeEmail(body.email);

    if (
      !organizationName ||
      !slug ||
      slug.length < 3 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      !fullName ||
      !email ||
      !validPassword(body.password)
    ) {
      fail(
        400,
        "Provide a valid organization name, slug, full name, email, and password. Password must contain at least 12 characters and at most 72 bytes."
      );
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const session = await transaction(async (client) => {
      // Plan and status use database defaults.
      const organizationResult = await client.query(
        `INSERT INTO auth.organizations (name, slug)
         VALUES ($1, $2)
         RETURNING id, name, slug, plan, status, created_at`,
        [organizationName, slug]
      );

      const organization = organizationResult.rows[0];

      // Public sign-up always creates an org_admin.
      const userResult = await client.query(
        `INSERT INTO auth.users
           (organization_id, full_name, email, password_hash,
            role, last_login_at)
         VALUES ($1, $2, $3, $4, 'org_admin', NOW())
         RETURNING *`,
        [organization.id, fullName, email, passwordHash]
      );

      const newSession = await createSession(
        client,
        userResult.rows[0]
      );

      return {
        ...newSession,
        organization,
      };
    });

    sendSession(res, session, 201);
  })
);

// Login with an existing account.
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(body.email);

    if (!email || !validPassword(body.password)) {
      fail(401, "Invalid email or password.");
    }

    const result = await pool.query(
      `SELECT *
       FROM auth.users
       WHERE LOWER(email) = $1`,
      [email]
    );

    const existingUser = result.rows[0];

    if (
      !existingUser ||
      !(await bcrypt.compare(body.password, existingUser.password_hash))
    ) {
      fail(401, "Invalid email or password.");
    }

    const session = await transaction(async (client) => {
      const lockedResult = await client.query(
        `SELECT u.*, o.status AS organization_status
         FROM auth.users u
         LEFT JOIN auth.organizations o
           ON o.id = u.organization_id
         WHERE u.id = $1
         FOR UPDATE OF u`,
        [existingUser.id]
      );

      const user = lockedResult.rows[0];

      checkAccount(user);

      // Reject if the password changed during login.
      if (user.password_hash !== existingUser.password_hash) {
        fail(401, "Account changed. Please log in again.");
      }

      const updatedResult = await client.query(
        `UPDATE auth.users
         SET last_login_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [user.id]
      );

      return createSession(client, updatedResult.rows[0]);
    });

    sendSession(res, session);
  })
);

// Replace a refresh token after one successful use.
router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const tokenHash = hashToken(readRefreshToken(req));

    const tokenResult = await pool.query(
      `SELECT user_id
       FROM auth.refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash]
    );

    const storedToken = tokenResult.rows[0];

    if (!storedToken) {
      fail(401, "Refresh token is invalid or expired.");
    }

    const session = await transaction(async (client) => {
      // Serialize session changes for this user.
      const userResult = await client.query(
        `SELECT u.*, o.status AS organization_status
         FROM auth.users u
         LEFT JOIN auth.organizations o
           ON o.id = u.organization_id
         WHERE u.id = $1
         FOR UPDATE OF u`,
        [storedToken.user_id]
      );

      const user = userResult.rows[0];

      checkAccount(user);

      // Only one request can consume this token.
      const revokedResult = await client.query(
        `UPDATE auth.refresh_tokens
         SET revoked_at = NOW()
         WHERE token_hash = $1
           AND user_id = $2
           AND revoked_at IS NULL
           AND expires_at > NOW()
         RETURNING id`,
        [tokenHash, user.id]
      );

      if (revokedResult.rowCount !== 1) {
        fail(401, "Refresh token is invalid or expired.");
      }

      return createSession(client, user);
    });

    sendSession(res, session);
  })
);

// Logout from the session stored in this cookie.
router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies.smartgate_refresh;

    if (typeof token === "string" && /^[a-f0-9]{64}$/.test(token)) {
      await pool.query(
        `UPDATE auth.refresh_tokens
         SET revoked_at = NOW()
         WHERE token_hash = $1
           AND revoked_at IS NULL`,
        [hashToken(token)]
      );
    }

    clearRefreshCookie(res);

    res.json({ message: "Logged out successfully." });
  })
);

// Return the currently authenticated user.
router.get("/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;