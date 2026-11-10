const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const {
  asyncHandler,
  fail,
  validUuid,
  publicUser,
  checkAccount,
} = require("../utils");

const authenticate = asyncHandler(async (req, res, next) => {
  const authorization = req.get("Authorization") || "";
  const parts = authorization.trim().split(/\s+/);

  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    fail(401, "Bearer access token is required.");
  }

  let payload;

  try {
    payload = jwt.verify(parts[1], process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "smartgate-auth",
      audience: "smartgate-platform",
    });
  } catch {
    fail(401, "Access token is invalid or expired.");
  }

  if (!validUuid(payload.sub) || !validUuid(payload.sid)) {
    fail(401, "Access token is invalid.");
  }

  // Use current database values for account and role checks.
  const result = await pool.query(
    `SELECT u.*, o.status AS organization_status
     FROM auth.users u
     LEFT JOIN auth.organizations o
       ON o.id = u.organization_id
     JOIN auth.refresh_tokens t
       ON t.user_id = u.id
     WHERE u.id = $1
       AND t.id = $2
       AND t.revoked_at IS NULL
       AND t.expires_at > NOW()`,
    [payload.sub, payload.sid]
  );

  const user = result.rows[0];

  checkAccount(user);

  req.user = publicUser(user);
  next();
});

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You do not have permission for this action.",
      });
    }

    next();
  };
}

module.exports = { authenticate, allowRoles };