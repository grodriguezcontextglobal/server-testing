const { paymentsPolicy } = require("../config/paymentsPolicy");

let logger = { warn: () => {} };
try {
  // Optional in test-only environments without installed deps.
  logger = require("../helpers/logger");
} catch (_err) {}

const buckets = new Map();

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded && typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
};

const getLimit = (path, lane = "public") => {
  if (path.includes("create-payment-intent")) {
    return lane === "authenticated"
      ? paymentsPolicy.createLimitAuthenticated
      : paymentsPolicy.createLimitPublic;
  }
  if (path.includes("capture") || path.includes("cancel") || path.includes("refund")) {
    return paymentsPolicy.mutationLimit;
  }
  return paymentsPolicy.createLimitPublic;
};

const publicPaymentRateLimit = (req, res, next) => {
  const ip = getClientIp(req);
  const path = req.originalUrl || req.path;
  const lane = req.authContext?.lane || "public";
  const key = `${ip}:${lane}:${path}`;
  const now = Date.now();
  const limit = getLimit(path, lane);

  const entry = buckets.get(key);
  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + paymentsPolicy.windowMs });
    return next();
  }

  if (entry.count >= limit) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res.set("Retry-After", String(retryAfterSec));

    if (paymentsPolicy.monitorMode) {
      logger.warn("payments_rate_limit_hit", {
        type: "payments_rate_limit_hit",
        path,
        lane,
        ip,
        limit,
        retryAfterSec,
      });
    }

    return res.status(429).json({
      ok: false,
      msg: "Too many requests. Please try again later.",
      retryAfterSec,
    });
  }

  entry.count += 1;
  buckets.set(key, entry);
  return next();
};

module.exports = {
  publicPaymentRateLimit,
};
