// Checks who is calling the Attendance service.
const crypto = require("crypto");
const { asyncHandler, fail, isUuid } = require("./helpers");

// Asks the Auth service whether the bearer token is valid, then saves the
// user on req.user. Every dashboard user must belong to an organization.
const authenticate = asyncHandler(async (req, res, next) => {
  const authorization = req.get("Authorization") || "";

  if (!/^Bearer\s+\S+$/i.test(authorization.trim())) {
    fail(401, "Bearer access token is required.");
  }

  let response;
  try {
    response = await fetch(`${process.env.AUTH_SERVICE_URL}/api/auth/me`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
  } catch (error) {
    console.error("Auth check failed:", error.code || error.name);
    fail(503, "Auth service is unavailable. Try again later.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    fail(502, "Auth service returned an unexpected response.");
  }

  if (response.status === 401 || response.status === 403) {
    fail(response.status, data.message || "Authentication failed.");
  }

  if (!response.ok || !isUuid(data.user?.id)) {
    fail(502, "Auth service returned an unexpected response.");
  }

  if (!isUuid(data.user.organization_id)) {
    fail(403, "An organization account is required.");
  }

  req.user = data.user;
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

// For /internal routes. The Recognition service sends the shared secret
// INTERNAL_SERVICE_KEY in the X-Internal-Key header. Both values are hashed
// first so timingSafeEqual can compare them safely.
function requireInternalKey(req, res, next) {
  const hash = (value) => crypto.createHash("sha256").update(value).digest();
  const given = req.get("X-Internal-Key") || "";

  if (
    !given ||
    !crypto.timingSafeEqual(hash(given), hash(process.env.INTERNAL_SERVICE_KEY))
  ) {
    return res.status(401).json({ message: "Invalid internal service key." });
  }

  next();
}

module.exports = { authenticate, allowRoles, requireInternalKey };
