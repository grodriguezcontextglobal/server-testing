const PAYMENT_INTENT_ID_REGEX = /^pi_[A-Za-z0-9]+$/;

const validatePaymentIntentIdParam = (req, res, next) => {
  const { id } = req.params;
  if (!id || !PAYMENT_INTENT_ID_REGEX.test(String(id))) {
    return res.status(422).json({
      ok: false,
      msg: "Invalid payment intent id",
    });
  }
  return next();
};

const validateRefundPayload = (req, res, next) => {
  const { payment_intent, paymentIntentId } = req.body || {};
  const candidate = payment_intent || paymentIntentId;

  if (!candidate || !PAYMENT_INTENT_ID_REGEX.test(String(candidate))) {
    return res.status(422).json({
      ok: false,
      msg: "Invalid refund payload",
      errors: [{ field: "payment_intent", message: "A valid payment intent id is required" }],
    });
  }

  return next();
};

module.exports = {
  validatePaymentIntentIdParam,
  validateRefundPayload,
};
