const crypto = require("crypto");
const { scopeIdempotencyKey } = require("../helpers/idempotencyScope");

const attachServerIdempotencyKey = (req, _res, next) => {
  const fromHeader = req.get("Idempotency-Key") || req.get("idempotency-key");

  if (fromHeader && String(fromHeader).trim()) {
    // Nunca la clave cruda del cliente: Stripe deduplica por CUENTA y hay una
    // sola para todas las compañías (Fase 1.2, helpers/idempotencyScope.js).
    req.idempotencyKey = scopeIdempotencyKey(req, fromHeader);
    return next();
  }

  const { customerEmail, customerId, device } = req.body || {};
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000)); // 5-min bucket

  const base = JSON.stringify({ customerEmail, customerId, device, ip, bucket });
  req.idempotencyKey = crypto.createHash("sha256").update(base).digest("hex");

  return next();
};

module.exports = {
  attachServerIdempotencyKey,
};
