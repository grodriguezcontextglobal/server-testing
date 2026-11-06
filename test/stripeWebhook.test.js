'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');

const { createStripeWebhookHandler } = require('../controller/stripeWebhook');

const SECRET = 'whsec_test_secret';
const COMPANY = '64b000000000000000000001';
const stripe = new Stripe('sk_test_placeholder');

/** Un evento firmado de verdad, como lo mandaría Stripe. */
function signedRequest(event) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return { body: Buffer.from(payload), headers: { 'stripe-signature': header }, ip: '3.18.12.63' };
}

const makeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
};

/** Una "colección" en memoria con la forma mínima de un modelo de Mongoose. */
function fakeStore(initial = []) {
  const rows = initial.map((r) => ({ ...r }));
  const asDoc = (row) => {
    const doc = row;
    doc.save = async () => {
      if (!rows.includes(doc)) rows.push(doc);
      return doc;
    };
    return doc;
  };
  function Model(data) {
    return asDoc({ plan: 'free', status: 'active', ...data });
  }
  Model.rows = rows;
  Model.findOne = async (filter) => {
    const row = rows.find((r) =>
      Object.entries(filter).every(([k, v]) => String(r[k]) === String(v))
    );
    return row ? asDoc(row) : null;
  };
  return Model;
}

function setup({ records = [], subscription } = {}) {
  const CompanySubscription = fakeStore(records);
  const processed = new Set();
  const activity = [];
  const deps = {
    stripe: {
      webhooks: stripe.webhooks,
      subscriptions: { retrieve: async () => subscription },
    },
    CompanySubscription,
    StripeWebhookEvent: {
      exists: async ({ _id }) => processed.has(_id),
      create: async ({ _id }) => processed.add(_id),
    },
    Company: { findById: () => ({ lean: async () => ({ _id: COMPANY, company_name: 'Acme' }) }) },
    logActivity: async (d) => activity.push(d),
    resolveSqlCompanyId: async () => 42,
  };
  return { handler: createStripeWebhookHandler(deps), CompanySubscription, processed, activity };
}

const proSubscription = (overrides = {}) => ({
  id: 'sub_1',
  object: 'subscription',
  status: 'trialing',
  customer: 'cus_1',
  cancel_at_period_end: false,
  current_period_end: 1767225600,
  trial_start: 1764633600,
  metadata: { company_id: COMPANY },
  items: { data: [{ price: { id: 'price_month', recurring: { interval: 'month' } } }] },
  ...overrides,
});

const event = (type, object, { id = `evt_${type}`, created = 1764633600 } = {}) => ({
  id,
  object: 'event',
  type,
  created,
  data: { object },
});

describe('POST /api/webhooks/stripe', () => {
  let savedSecret;
  beforeEach(() => {
    savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    if (savedSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
  });

  test('firma inválida: 400 y no toca nada', async () => {
    const { handler, CompanySubscription } = setup();
    const req = signedRequest(event('checkout.session.completed', {}));
    req.body = Buffer.from(req.body.toString().replace('checkout', 'checkouT'));
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(CompanySubscription.rows.length, 0);
  });

  test('sin STRIPE_WEBHOOK_SECRET: 503 (Stripe reintenta)', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { handler } = setup();
    const res = makeRes();
    await handler(signedRequest(event('invoice.paid', {})), res);
    assert.equal(res.statusCode, 503);
  });

  test('checkout.session.completed: la compañía pasa a Pro con los datos de la suscripción', async () => {
    const { handler, CompanySubscription, activity } = setup({ subscription: proSubscription() });
    const res = makeRes();
    await handler(
      signedRequest(
        event('checkout.session.completed', {
          object: 'checkout.session',
          mode: 'subscription',
          subscription: 'sub_1',
          customer: 'cus_1',
          client_reference_id: COMPANY,
        })
      ),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.outcome, 'applied');
    const row = CompanySubscription.rows[0];
    assert.equal(String(row.company), COMPANY);
    assert.equal(row.plan, 'pro');
    assert.equal(row.status, 'trialing');
    assert.equal(row.interval, 'month');
    assert.equal(row.stripe_subscription_id, 'sub_1');
    assert.equal(row.stripe_customer_id, 'cus_1');
    assert.equal(row.trial_used, true);
    assert.equal(row.sql_company_id, 42);
    assert.equal(row.current_period_end.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(activity[0].action, 'PLAN_CHANGE');
    assert.equal(activity[0].details.event_id, 'evt_checkout.session.completed');
  });

  test('el mismo evento dos veces: el segundo no hace nada', async () => {
    const { handler, activity } = setup({ subscription: proSubscription() });
    const ev = event('checkout.session.completed', {
      mode: 'subscription',
      subscription: 'sub_1',
      client_reference_id: COMPANY,
    });
    await handler(signedRequest(ev), makeRes());
    const res = makeRes();
    await handler(signedRequest(ev), res);
    assert.equal(res.body.duplicate, true);
    assert.equal(activity.length, 1);
  });

  test('subscription.updated: copia estado, intervalo y cancel_at_period_end', async () => {
    const { handler, CompanySubscription } = setup({
      records: [{ company: COMPANY, plan: 'pro', status: 'trialing', stripe_subscription_id: 'sub_1', stripe_event_created: 100 }],
    });
    const res = makeRes();
    await handler(
      signedRequest(
        event('customer.subscription.updated', proSubscription({
          status: 'active',
          cancel_at_period_end: true,
          items: { data: [{ price: { recurring: { interval: 'year' } } }] },
        }))
      ),
      res
    );
    const row = CompanySubscription.rows[0];
    assert.equal(row.status, 'active');
    assert.equal(row.interval, 'year');
    assert.equal(row.cancel_at_period_end, true);
  });

  test('un evento más viejo que el aplicado no pisa el estado (orden)', async () => {
    const { handler, CompanySubscription } = setup({
      records: [{ company: COMPANY, plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1', stripe_event_created: 2000 }],
    });
    const res = makeRes();
    await handler(
      signedRequest(event('customer.subscription.updated', proSubscription({ status: 'past_due' }), { created: 1000 })),
      res
    );
    assert.equal(res.body.outcome, 'stale');
    assert.equal(CompanySubscription.rows[0].status, 'active');
  });

  test('subscription.deleted: vuelve a Free y suelta la suscripción', async () => {
    const { handler, CompanySubscription } = setup({
      records: [{ company: COMPANY, plan: 'pro', status: 'active', interval: 'month', stripe_subscription_id: 'sub_1' }],
    });
    await handler(signedRequest(event('customer.subscription.deleted', proSubscription({ status: 'canceled' }))), makeRes());
    const row = CompanySubscription.rows[0];
    assert.equal(row.plan, 'free');
    assert.equal(row.status, 'canceled');
    assert.equal(row.interval, null);
    assert.equal(row.stripe_subscription_id, null);
  });

  test('invoice.payment_failed → past_due; invoice.paid → active', async () => {
    const { handler, CompanySubscription } = setup({
      records: [{ company: COMPANY, plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' }],
    });
    await handler(signedRequest(event('invoice.payment_failed', { subscription: 'sub_1' }, { created: 10 })), makeRes());
    assert.equal(CompanySubscription.rows[0].status, 'past_due');
    // forma nueva de la API (2025-03-31+): la suscripción va en parent
    await handler(
      signedRequest(event('invoice.paid', { parent: { subscription_details: { subscription: 'sub_1' } } }, { created: 20 })),
      makeRes()
    );
    assert.equal(CompanySubscription.rows[0].status, 'active');
  });

  test('la factura de 0 $ del inicio de la prueba no pasa trialing a active', async () => {
    const { handler, CompanySubscription } = setup({
      records: [{ company: COMPANY, plan: 'pro', status: 'trialing', stripe_subscription_id: 'sub_1' }],
    });
    await handler(signedRequest(event('invoice.paid', { subscription: 'sub_1' })), makeRes());
    assert.equal(CompanySubscription.rows[0].status, 'trialing');
  });

  test('suscripciones de los planes viejos (sin metadata ni fila): se ignoran', async () => {
    const { handler, CompanySubscription } = setup();
    const res = makeRes();
    await handler(
      signedRequest(event('customer.subscription.updated', proSubscription({ id: 'sub_old', metadata: {} }))),
      res
    );
    assert.equal(res.body.outcome, 'ignored');
    assert.equal(CompanySubscription.rows.length, 0);
  });

  test('tipos de evento que no manejamos: 200 sin procesar', async () => {
    const { handler } = setup();
    const res = makeRes();
    await handler(signedRequest(event('charge.succeeded', {})), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ignored, true);
  });

  test('si falla al aplicar: 500 para que Stripe reintente, y no se marca como procesado', async () => {
    const { handler, processed } = setup({ subscription: proSubscription() });
    const res = makeRes();
    const failing = createStripeWebhookHandler({
      stripe: { webhooks: stripe.webhooks, subscriptions: { retrieve: async () => { throw new Error('stripe down'); } } },
      CompanySubscription: fakeStore(),
      StripeWebhookEvent: { exists: async () => false, create: async ({ _id }) => processed.add(_id) },
      Company: { findById: () => ({ lean: async () => ({ company_name: 'Acme' }) }) },
      logActivity: async () => {},
      resolveSqlCompanyId: async () => 42,
    });
    await failing(
      signedRequest(event('checkout.session.completed', { mode: 'subscription', subscription: 'sub_1', client_reference_id: COMPANY })),
      res
    );
    assert.equal(res.statusCode, 500);
    assert.equal(processed.size, 0);
    assert.ok(handler);
  });
});

describe('montaje', () => {
  test('el webhook se monta ANTES del middleware global (cuerpo crudo, sin limitador global)', () => {
    const source = require('node:fs').readFileSync(require.resolve('../index.js'), 'utf8');
    const webhook = source.indexOf('app.use(require("./routes/stripeWebhook"))');
    const global = source.indexOf('configureMiddleware(app);');
    assert.ok(webhook > 0 && webhook < global);
  });

  test('la ruta lleva express.raw', () => {
    const router = require('../routes/stripeWebhook');
    const layer = router.stack.find((l) => l.route?.path === '/api/webhooks/stripe');
    assert.ok(layer.route.methods.post);
    assert.ok(layer.route.stack.some((l) => l.name === 'rawParser'));
  });
});
