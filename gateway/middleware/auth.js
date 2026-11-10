async function authenticate(req, res, next) {
  const authorization = req.get("Authorization") || "";

  if (!/^Bearer\s+\S+$/i.test(authorization.trim())) {
    return res.status(401).json({
      message: "Bearer access token is required.",
    });
  }

  try {
    const response = await fetch(
      `${process.env.AUTH_SERVICE_URL}/api/auth/me`,
      {
        headers: {
          Authorization: authorization,
        },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      }
    );

    const data = await response.json();

    if (response.status === 401 || response.status === 403) {
      return res.status(response.status).json({
        message: data.message || "Authentication failed.",
      });
    }

    if (!response.ok || !data.user?.id) {
      return res.status(502).json({
        message: "Auth service returned an unexpected response.",
      });
    }

    req.user = data.user;
    next();
  } catch (error) {
    console.error("Auth check failed:", error.code || error.name);

    res.status(503).json({
      message: "Auth service is unavailable. Try again later.",
    });
  }
}

module.exports = { authenticate };