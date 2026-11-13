const { asyncHandler, fail, validUuid } = require("../utils");

const authenticate = asyncHandler(async (req, res, next) => {
  const authorization = req.get("Authorization") || "";

  if (!/^Bearer\s+\S+$/i.test(authorization.trim())) {
    fail(401, "Bearer access token is required.");
  }

  let response;

  try {
    response = await fetch(
      `${process.env.AUTH_SERVICE_URL}/api/auth/me`,
      {
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      }
    );
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

  if (!response.ok || !validUuid(data.user?.id)) {
    fail(502, "Auth service returned an unexpected response.");
  }

  req.user = data.user;
  next();
});

function requireOrganization(req, res, next) {
  if (!validUuid(req.user?.organization_id)) {
    return res.status(403).json({
      message: "An organization account is required.",
    });
  }

  next();
}

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

module.exports = { authenticate, requireOrganization, allowRoles };
