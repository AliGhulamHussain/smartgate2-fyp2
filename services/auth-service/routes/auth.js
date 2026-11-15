// Signup, login, refresh, logout and "who am I".
const express = require("express");
const bcrypt = require("bcryptjs");
const { pool, transaction } = require("../db");
const { authenticate } = require("../auth");
const { asyncHandler, fail, readText, readEmail, isValidPassword } = require("../helpers");
const {
  checkAccount,
  loadUserForUpdate,
  hashToken,
  getRefreshToken,
  createSession,
  sendSession,
  clearRefreshCookie,
} = require("../sessions");

const router = express.Router();

// POST /api/auth/signup
// Creates a new organization and its first admin in one transaction,
// so we never end up with an organization that has no admin.
router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    const organizationName = readText(body.organization_name, 150);
    const slug = readText(body.organization_slug, 60)?.toLowerCase();
    const fullName = readText(body.full_name, 100);
    const email = readEmail(body.email);

    // slug: lower-case words joined by dashes, e.g. "city-school"
    const validSlug = slug && slug.length >= 3 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);

    if (!organizationName || !validSlug || !fullName || !email || !isValidPassword(body.password)) {
      fail(
        400,
        "Provide a valid organization name, slug, full name, email, and password. Password must contain at least 12 characters and at most 72 bytes."
      );
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const session = await transaction(async (client) => {
      const orgResult = await client.query(
        `INSERT INTO auth.organizations (name, slug)
         VALUES ($1, $2)
         RETURNING id, name, slug, plan, status, created_at`,
        [organizationName, slug]
      );
      const organization = orgResult.rows[0];

      const userResult = await client.query(
        `INSERT INTO auth.users
           (organization_id, full_name, email, password_hash, role, last_login_at)
         VALUES ($1, $2, $3, $4, 'org_admin', NOW())
         RETURNING *`,
        [organization.id, fullName, email, passwordHash]
      );

      const newSession = await createSession(client, userResult.rows[0]);
      return { ...newSession, organization };
    });

    sendSession(res, session, 201);
  })
);

// POST /api/auth/login
// Every failure says "Invalid email or password" so nobody can find out
// which emails have accounts.
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const email = readEmail(body.email);

    if (!email || !isValidPassword(body.password)) {
      fail(401, "Invalid email or password.");
    }

    const found = await pool.query("SELECT * FROM auth.users WHERE LOWER(email) = $1", [email]);
    const existingUser = found.rows[0];

    if (!existingUser || !(await bcrypt.compare(body.password, existingUser.password_hash))) {
      fail(401, "Invalid email or password.");
    }

    const session = await transaction(async (client) => {
      const user = await loadUserForUpdate(client, existingUser.id);
      checkAccount(user);

      // The password was changed while we were checking it.
      if (user.password_hash !== existingUser.password_hash) {
        fail(401, "Account changed. Please log in again.");
      }

      const updated = await client.query(
        "UPDATE auth.users SET last_login_at = NOW() WHERE id = $1 RETURNING *",
        [user.id]
      );

      return createSession(client, updated.rows[0]);
    });

    sendSession(res, session);
  })
);

// POST /api/auth/refresh
// Swaps the refresh token in the cookie for a new pair of tokens. The old
// refresh token is revoked, so each one works only once (token rotation).
router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = getRefreshToken(req);

    if (!token) {
      fail(401, "A valid refresh token is required.");
    }

    const tokenHash = hashToken(token);

    const stored = await pool.query(
      "SELECT user_id FROM auth.refresh_tokens WHERE token_hash = $1",
      [tokenHash]
    );

    if (!stored.rows[0]) {
      fail(401, "Refresh token is invalid or expired.");
    }

    const session = await transaction(async (client) => {
      const user = await loadUserForUpdate(client, stored.rows[0].user_id);
      checkAccount(user);

      // Only one request can use this token: the update only matches while
      // it is still unrevoked and unexpired.
      const revoked = await client.query(
        `UPDATE auth.refresh_tokens
         SET revoked_at = NOW()
         WHERE token_hash = $1
           AND user_id = $2
           AND revoked_at IS NULL
           AND expires_at > NOW()
         RETURNING id`,
        [tokenHash, user.id]
      );

      if (revoked.rowCount !== 1) {
        fail(401, "Refresh token is invalid or expired.");
      }

      return createSession(client, user);
    });

    sendSession(res, session);
  })
);

// POST /api/auth/logout
// Revokes the session in the cookie (if any) and clears the cookie.
router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = getRefreshToken(req);

    if (token) {
      await pool.query(
        `UPDATE auth.refresh_tokens
         SET revoked_at = NOW()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashToken(token)]
      );
    }

    clearRefreshCookie(res);
    res.json({ message: "Logged out successfully." });
  })
);

// GET /api/auth/me
// The gateway and the other services call this to check a token.
router.get("/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = { router };
