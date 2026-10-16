'use strict';

// Forma de la respuesta de GET /api/stripe/payment_intents/:id.
//
// 1. `charges` ya no existe. El SDK fija la API de Stripe (2025-02-24.acacia
//    hoy) y desde 2022-11-15 el PaymentIntent no trae `charges`. La app del
//    consumidor y el dashboard leen la tarjeta y el recibo de
//    `charges.data[0]`, así que mostraban "XXXX" / "ending in: undefined" y
//    ningún recibo. Se expande `latest_charge` y se rellena `charges.data[0]`
//    con ese cargo, para que los dos frontends vuelvan a funcionar sin cambios.
// 2. Campos planos (`card`, `receiptUrl`, `amountCapturable`…): la forma a la
//    que tienen que migrar (BACKEND_consumer_app_preguntas_REPLY_2026-10-15.md, Q4a).
// 3. Sin sesión de staff, solo lo que la app lee. Antes iba el objeto entero,
//    con `client_secret`, cliente y metadata, a quien conociera el id.

const chargeOf = (paymentIntent) => {
  const latest = paymentIntent?.latest_charge;
  if (latest && typeof latest === 'object') return latest;
  return paymentIntent?.charges?.data?.[0] ?? null;
};

const cardOf = (charge) => {
  const card = charge?.payment_method_details?.card;
  return card ? { last4: card.last4 ?? null, network: card.network ?? card.brand ?? null } : null;
};

function flatFields(paymentIntent) {
  const charge = chargeOf(paymentIntent);
  return {
    id: paymentIntent.id,
    status: paymentIntent.status,
    amount: paymentIntent.amount,
    amountCapturable: paymentIntent.amount_capturable,
    currency: paymentIntent.currency,
    card: cardOf(charge),
    receiptUrl: charge?.receipt_url ?? null,
  };
}

/** Staff: el objeto entero de Stripe, más `charges` compatible y la forma plana. */
function staffView(paymentIntent) {
  const charge = chargeOf(paymentIntent);
  return {
    ...paymentIntent,
    charges: paymentIntent.charges ?? { object: 'list', data: charge ? [charge] : [] },
    ...flatFields(paymentIntent),
  };
}

/**
 * Sin sesión: la forma plana, y los dos campos con la forma vieja que lee la
 * versión actual de la app (`amount_capturable` y `charges.data[0]` con
 * tarjeta y recibo). Esos dos se quitan cuando la app lea la forma plana.
 */
function publicView(paymentIntent) {
  const flat = flatFields(paymentIntent);
  return {
    ...flat,
    amount_capturable: paymentIntent.amount_capturable,
    charges: {
      data: flat.card || flat.receiptUrl
        ? [{ payment_method_details: { card: flat.card }, receipt_url: flat.receiptUrl }]
        : [],
    },
  };
}

// Los ids que genera la app para pedidos sin depósito ("pi_" + nanoid(12)) miden
// 15 y no existen en Stripe. Antes, con 15 o menos, el handler no respondía y la
// petición colgaba hasta el 408.
const isRetrievableId = (id) => typeof id === 'string' && id.length > 15;

module.exports = { staffView, publicView, isRetrievableId };
