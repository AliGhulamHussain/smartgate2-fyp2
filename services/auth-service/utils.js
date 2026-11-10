const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const COOKIE_NAME = "smartgate_refresh";

const JWT_OPTIONS = {
  algorithm: "HS256",
  issuer: "smartgate-auth",
  audience: "smartgate-platform",
  expiresIn: "15m",
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/auth",
};

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  error.public = true;
  throw error;
}

function text(value, maxLength) {
  if (typeof value !== "string") return null;

  const cleaned = value.trim();

  if (!cleaned || cleaned.length > maxLength) return null;

  return cleaned;
}

function normalizeEmail(value) {
  const email = text(value, 150)?.toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  return email;
}

function validPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    Buffer.byteLength(value, "utf8") <= 72
  );
}

function validUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function readDepartment(value) {
  if (value === undefined || value === null) return null;

  if (typeof value !== "string" || value.trim().length > 100) {
    fail(400, "Department must be a string of up to 100 characters.");
  }

  return value.trim() || null;
}

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

function checkAccount(user) {
  if (!user || !user.is_active) {
    fail(401, "Account is unavailable.");
  }

  if (
    user.role !== "super_admin" &&
    user.organization_status !== "active"
  ) {
    fail(403, "Organization is suspended or unavailable.");
  }
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function readRefreshToken(req) {
  const token = req.cookies[COOKIE_NAME];

  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    fail(401, "A valid refresh token is required.");
  }

  return token;
}

async function createSession(client, user) {
  const refreshToken = crypto.randomBytes(32).toString("hex");

  const result = await client.query(
    `INSERT INTO auth.refresh_tokens
       (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '14 days')
     RETURNING id`,
    [user.id, hashToken(refreshToken)]
  );

  const accessToken = jwt.sign(
    {
      sid: result.rows[0].id,
      organization_id: user.organization_id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      ...JWT_OPTIONS,
      subject: user.id,
    }
  );

  return {
    accessToken,
    refreshToken,
    user: publicUser(user),
  };
}

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
  asyncHandler,
  fail,
  text,
  normalizeEmail,
  validPassword,
  validUuid,
  readDepartment,
  publicUser,
  checkAccount,
  hashToken,
  readRefreshToken,
  createSession,
  sendSession,
  clearRefreshCookie,
};