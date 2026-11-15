// Checks the access token on each request.
const jwt = require("jsonwebtoken");
const { pool } = require("./db");
const { asyncHandler, fail, isUuid } = require("./helpers");
const { JWT_SETTINGS, publicUser, checkAccount } = require("./sessions");

// Reads "Authorization: Bearer <token>", checks the JWT signature and expiry,
// then loads the user from the database. The database is checked every time
// so a deactivated user, a suspended organization or a logged-out session
// stops working at once instead of after 15 minutes.
const authenticate = asyncHandler(async (req, res, next) => {
  const parts = (req.get("Authorization") || "").trim().split(/\s+/);

  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    fail(401, "Bearer access token is required.");
  }

  let payload;
  try {
    payload = jwt.verify(parts[1], process.env.JWT_SECRET, {
      algorithms: [JWT_SETTINGS.algorithm],
      issuer: JWT_SETTINGS.issuer,
      audience: JWT_SETTINGS.audience,
    });
  } catch {
    fail(401, "Access token is invalid or expired.");
  }

  // sub = user id, sid = session (refresh token) id
  if (!isUuid(payload.sub) || !isUuid(payload.sid)) {
    fail(401, "Access token is invalid.");
  }

  const result = await pool.query(
    `SELECT u.*, o.status AS organization_status
     FROM auth.users u
     LEFT JOIN auth.organizations o ON o.id = u.organization_id
     JOIN auth.refresh_tokens t ON t.user_id = u.id
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

// Usage: allowRoles("org_admin") lets only organization admins through.
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({
        message: "You do not have permission for this action.",
      });
    }
    next();
  };
}

module.exports = { authenticate, allowRoles };
