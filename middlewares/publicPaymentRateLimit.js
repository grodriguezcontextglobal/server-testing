const WINDOW_MS = Number(process.env.PUBLIC_PAYMENTS_WINDOW_MS || 5 * 60 * 1000);
const CREATE_LIMIT = Number(process.env.PUBLIC_PAYMENTS_CREATE_LIMIT || 30);
const AUTH_CREATE_LIMIT = Number(process.env.AUTH_PAYMENTS_CREATE_LIMIT || 120);
const MUTATION_LIMIT = Number(process.env.PUBLIC_PAYMENTS_MUTATION_LIMIT || 10);

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
    return lane === "authenticated" ? AUTH_CREATE_LIMIT : CREATE_LIMIT;
  }
  if (path.includes("capture") || path.includes("cancel") || path.includes("refund")) return MUTATION_LIMIT;
  return CREATE_LIMIT;
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
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  if (entry.count >= limit) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res.set("Retry-After", String(retryAfterSec));
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
