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

// Los controladores de refund (refundStripePaymentIntent,
// partialRefundStripePaymentIntent) leen `paymentIntent`, que es lo que manda
// el dashboard. Este validador solo aceptaba `payment_intent`/`paymentIntentId`:
// el payload del dashboard daba 422, y uno con `payment_intent` pasaba pero
// llegaba a Stripe como undefined. Ningún payload funcionaba. Se aceptan los
// tres nombres y el valor validado se deja en `paymentIntent`.
const validateRefundPayload = (req, res, next) => {
  const { paymentIntent, payment_intent, paymentIntentId } = req.body || {};
  const candidate = paymentIntent || payment_intent || paymentIntentId;

  if (!candidate || !PAYMENT_INTENT_ID_REGEX.test(String(candidate))) {
    return res.status(422).json({
      ok: false,
      msg: "Invalid refund payload",
      errors: [{ field: "paymentIntent", message: "A valid payment intent id is required" }],
    });
  }

  req.body.paymentIntent = String(candidate);
  return next();
};

module.exports = {
  validatePaymentIntentIdParam,
  validateRefundPayload,
};
