// Login sessions.
//
// After login the user gets two things:
//   - an access token (JWT, valid 15 minutes), sent with every request
//   - a refresh token (random, valid 14 days) in an HttpOnly cookie, used
//     only to get a new access token. The database stores just its hash.
//
// Each refresh token row is one "session". The access token carries the
// session id (sid), so revoking the row also ends the access token.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { fail } = require("./helpers");

const COOKIE_NAME = "smartgate_refresh";

const COOKIE_OPTIONS = {
  httpOnly: true, // JavaScript in the browser cannot read it
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/auth", // only sent to the auth routes
};

const JWT_SETTINGS = {
  algorithm: "HS256",
  issuer: "smartgate-auth",
  audience: "smartgate-platform",
};

// The user fields that are safe to send to the browser (no password hash).
function publicUser(user) {
  return {
    id: user.id,
    organization_id: user.organization_id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    department: user.department,
    is_active: user.is_active,
    last_login_at: user.last_login_at,
    created_at: user.created_at,
  };
}

// The account must be active, and its organization too
// (a super_admin has no organization).
function checkAccount(user) {
  if (!user || !user.is_active) {
    fail(401, "Account is unavailable.");
  }

  if (user.role !== "super_admin" && user.organization_status !== "active") {
    fail(403, "Organization is suspended or unavailable.");
  }
}

// Loads a user with their organization's status and locks the user row,
// so two logins or refreshes for the same user run one after another.
async function loadUserForUpdate(client, userId) {
  const result = await client.query(
    `SELECT u.*, o.status AS organization_status
     FROM auth.users u
     LEFT JOIN auth.organizations o ON o.id = u.organization_id
     WHERE u.id = $1
     FOR UPDATE OF u`,
    [userId]
  );
  return result.rows[0];
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// The refresh token from the cookie, or null if there is no valid one.
function getRefreshToken(req) {
  const token = req.cookies[COOKIE_NAME];
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

// Creates a session row and both tokens.
async function createSession(client, user) {
  const refreshToken = crypto.randomBytes(32).toString("hex");

  const result = await client.query(
    `INSERT INTO auth.refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '14 days')
     RETURNING id`,
    [user.id, hashToken(refreshToken)]
  );

  const accessToken = jwt.sign(
    { sid: result.rows[0].id, organization_id: user.organization_id, role: user.role },
    process.env.JWT_SECRET,
    { ...JWT_SETTINGS, subject: user.id, expiresIn: "15m" }
  );

  return { accessToken, refreshToken, user: publicUser(user) };
}

// Puts the refresh token in the cookie and sends the rest as JSON.
function sendSession(res, session, status = 200) {
  const { refreshToken, ...response } = session;

  res.cookie(COOKIE_NAME, refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: 14 * 24 * 60 * 60 * 1000,
  });

  return res.status(status).json(response);
}

function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
}

module.exports = {
  JWT_SETTINGS,
  publicUser,
  checkAccount,
  loadUserForUpdate,
  hashToken,
  getRefreshToken,
  createSession,
  sendSession,
  clearRefreshCookie,
};
