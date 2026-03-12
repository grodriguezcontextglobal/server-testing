const validatePublicPaymentPayload = (req, res, next) => {
  const { device } = req.body;

  // Backward-compatible: existing client sends `device` as amount in dollars.
  const parsed = Number(device);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return res.status(422).json({
      ok: false,
      msg: "Invalid payment payload",
      errors: [{ field: "device", message: "device must be a positive number" }],
    });
  }

  // Guardrail: avoid accidental extremely large amounts.
  if (parsed > 100000) {
    return res.status(422).json({
      ok: false,
      msg: "Invalid payment payload",
      errors: [{ field: "device", message: "device exceeds allowed maximum" }],
    });
  }

  return next();
};

module.exports = {
  validatePublicPaymentPayload,
};
