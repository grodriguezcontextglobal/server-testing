const crypto = require("crypto");

const TTL_MS = Number(process.env.PAYMENTS_MUTATION_IDEMPOTENCY_TTL_MS || 10 * 60 * 1000);
const store = new Map();

const stableStringify = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
};

const buildKey = (req) => {
  const headerKey = req.get("Idempotency-Key") || req.get("idempotency-key");
  if (headerKey) return `hdr:${String(headerKey).trim()}`;

  const signature = {
    method: req.method,
    path: req.route?.path || req.path || req.originalUrl,
    params: req.params || {},
    body: req.body || {},
  };

  return crypto.createHash("sha256").update(stableStringify(signature)).digest("hex");
};

const idempotencyMutationCache = (req, res, next) => {
  const now = Date.now();
  const key = buildKey(req);
  const current = store.get(key);

  if (current && now < current.expiresAt) {
    return res.status(current.statusCode).json(current.body);
  }

  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const statusCode = res.statusCode || 200;
    if (statusCode >= 200 && statusCode < 500) {
      store.set(key, {
        statusCode,
        body: payload,
        expiresAt: Date.now() + TTL_MS,
      });
    }
    return originalJson(payload);
  };

  return next();
};

module.exports = {
  idempotencyMutationCache,
  __idempotencyStore: store,
};
