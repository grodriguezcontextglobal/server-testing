const crypto = require("crypto");

const attachServerIdempotencyKey = (req, _res, next) => {
  const fromHeader = req.get("Idempotency-Key") || req.get("idempotency-key");

  if (fromHeader && String(fromHeader).trim()) {
    req.idempotencyKey = String(fromHeader).trim();
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
