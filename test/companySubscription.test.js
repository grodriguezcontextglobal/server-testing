'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  createGetCompanySubscription,
  createSubscriptionCheckout,
  createSubscriptionPortal,
} = require('../controller/companySubscription');
const { effectiveChain } = require('./helpers/effectiveChain');

const COMPANY = '64b000000000000000000001';

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

const makeReq = ({ body = {}, uid = 'u1', company = COMPANY } = {}) => ({
  uid,
  ip: '1.2.3.4',
  body,
  headers: { 'x-company-id': company },
  header(name) {
    return this.headers[name.toLowerCase()];
  },
});

const lean = (value) => ({ lean: async () => value, select: () => ({ lean: async () => value }) });

function fakeDeps({ record = null, adminUser = { email: 'a@x.com' }, emp = { roleType: 'admin', active: true } } = {}) {
  const calls = { checkout: [], portal: [], upserts: [], activity: [], customers: [] };
  const deps = {
    AdminUser: { findById: () => lean(adminUser) },
    Company: {
      findById: () => lean({ _id: COMPANY, company_name: 'Acme', stripe_customer_id: 'unknown' }),
    },
    CompanySubscription: {
      findOne: () => lean(record),
      updateOne: async (filter, update, opts) => calls.upserts.push({ filter, update, opts }),
    },
    findCompanyMembership: async () => emp,
    resolveSqlCompanyId: async () => 42,
    countUsage: async (resource) => (resource === 'staff' ? 2 : 840),
    runStripeMutation: (fn) => fn(),
    stripe: {
      customers: {
        create: async (params, opts) => {
          calls.customers.push({ params, opts });
          return { id: 'cus_new' };
        },
      },
      checkout: {
        sessions: {
          create: async (params) => {
            calls.checkout.push(params);
            return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
          },
        },
      },
      billingPortal: {
        sessions: {
          create: async (params) => {
            calls.portal.push(params);
            return { url: 'https://billing.stripe.com/p/session/x' };
          },
        },
      },
    },
    logActivity: async (d) => calls.activity.push(d),
  };
  return { deps, calls };
}

describe('GET /api/company/subscription', () => {
  test('sin fila: Free, con topes, uso y can_manage_billing del rol', async () => {
    const { deps } = fakeDeps();
    const res = makeRes();
    await createGetCompanySubscription(deps)(makeReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.plan, 'free');
    assert.equal(res.body.status, 'active');
    assert.equal(res.body.interval, null);
    assert.deepEqual(res.body.limits, { staff: 3, items: 1000 });
    assert.deepEqual(res.body.usage, { staff: 2, items: 840 });
    assert.equal(res.body.can_manage_billing, true);
    assert.equal(res.body.trial_available, true);
  });

  test('un rol sin billing:update puede leer, pero can_manage_billing es false', async () => {
    const { deps } = fakeDeps({ emp: { roleType: 'assistant', active: true } });
    const res = makeRes();
    await createGetCompanySubscription(deps)(makeReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.can_manage_billing, false);
  });

  test('quien no es miembro de la compañía: 403', async () => {
    const { deps } = fakeDeps({ emp: null });
    const res = makeRes();
    await createGetCompanySubscription(deps)(makeReq(), res);
    assert.equal(res.statusCode, 403);
  });

  test('sin x-company-id: 400', async () => {
    const { deps } = fakeDeps();
    const res = makeRes();
    await createGetCompanySubscription(deps)(makeReq({ company: null }), res);
    assert.equal(res.statusCode, 400);
  });

  test('cuenta demo: plan free, sin topes y demo: true', async () => {
    const { deps } = fakeDeps({ record: { plan: 'free', status: 'active', demo: true } });
    const res = makeRes();
    await createGetCompanySubscription(deps)(makeReq(), res);
    assert.equal(res.body.plan, 'free');
    assert.equal(res.body.effective_plan, 'free');
    assert.equal(res.body.demo, true);
    assert.deepEqual(res.body.limits, { staff: null, items: null });
  });

  test('Pro con override: topes efectivos', async () => {
    const { deps } = fakeDeps({
      record: { plan: 'pro', status: 'trialing', interval: 'year', limit_overrides: { staff: 12 }, trial_used: true },
    });
    const res = makeRes();
    await createGetCompanySubscription(deps)(makeReq(), res);
    assert.equal(res.body.plan, 'pro');
    assert.deepEqual(res.body.limits, { staff: 12, items: 4000 });
    assert.equal(res.body.trial_available, false);
  });
});

describe('POST /api/company/subscription/checkout', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['STRIPE_PRICE_PRO_MONTH', 'STRIPE_PRICE_PRO_YEAR', 'SUBSCRIPTION_TRIAL_DAYS', 'FRONTEND_URL']) {
      saved[k] = process.env[k];
    }
    process.env.STRIPE_PRICE_PRO_MONTH = 'price_month';
    process.env.STRIPE_PRICE_PRO_YEAR = 'price_year';
    delete process.env.SUBSCRIPTION_TRIAL_DAYS;
    delete process.env.FRONTEND_URL;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('crea la sesión con el precio de la config, la compañía del contexto y 30 días de prueba', async () => {
    const { deps, calls } = fakeDeps();
    const res = makeRes();
    await createSubscriptionCheckout(deps)(
      makeReq({ body: { plan: 'pro', interval: 'year', price: 'price_hacker', company_id: 'otra' } }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.url, 'https://checkout.stripe.com/c/pay/cs_1');
    const p = calls.checkout[0];
    assert.equal(p.mode, 'subscription');
    assert.deepEqual(p.line_items, [{ price: 'price_year', quantity: 1 }]);
    assert.equal(p.customer, 'cus_new');
    assert.equal(p.client_reference_id, COMPANY);
    assert.equal(p.subscription_data.metadata.company_id, COMPANY);
    assert.equal(p.subscription_data.trial_period_days, 30);
    assert.equal(p.success_url, 'https://admin.devitrak.net/profile/subscription?checkout=success');
    assert.equal(p.cancel_url, 'https://admin.devitrak.net/profile/subscription?checkout=canceled');
    // el cliente de Stripe queda en la fila del plan (no en Company)
    assert.equal(calls.upserts[0].update.$set.stripe_customer_id, 'cus_new');
    assert.equal(calls.upserts[0].update.$set.sql_company_id, 42);
    assert.equal(calls.activity[0].target_model, 'Subscription');
  });

  test('sin prueba si la compañía ya la usó', async () => {
    const { deps, calls } = fakeDeps({ record: { plan: 'free', status: 'canceled', trial_used: true, stripe_customer_id: 'cus_old' } });
    const res = makeRes();
    await createSubscriptionCheckout(deps)(makeReq({ body: { plan: 'pro', interval: 'month' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.checkout[0].subscription_data.trial_period_days, undefined);
    assert.equal(calls.checkout[0].customer, 'cus_old');
    assert.equal(calls.customers.length, 0);
  });

  test('enterprise u otro plan: 400; intervalo inválido: 400', async () => {
    for (const body of [{ plan: 'enterprise', interval: 'month' }, { plan: 'basic', interval: 'month' }, { plan: 'pro', interval: 'week' }]) {
      const { deps } = fakeDeps();
      const res = makeRes();
      await createSubscriptionCheckout(deps)(makeReq({ body }), res);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.body.ok, false);
    }
  });

  test('ya en Pro al día: 409 (mismo intervalo o el otro)', async () => {
    for (const interval of ['month', 'year']) {
      const { deps, calls } = fakeDeps({ record: { plan: 'pro', status: 'active', interval: 'month' } });
      const res = makeRes();
      await createSubscriptionCheckout(deps)(makeReq({ body: { plan: 'pro', interval } }), res);
      assert.equal(res.statusCode, 409);
      assert.equal(calls.checkout.length, 0);
    }
  });

  test('precio sin configurar: 503 y no llama a Stripe', async () => {
    delete process.env.STRIPE_PRICE_PRO_MONTH;
    const { deps, calls } = fakeDeps();
    const res = makeRes();
    await createSubscriptionCheckout(deps)(makeReq({ body: { plan: 'pro', interval: 'month' } }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(calls.checkout.length, 0);
  });
});

describe('POST /api/company/subscription/portal', () => {
  test('devuelve la URL del Billing Portal del cliente de la compañía', async () => {
    const { deps, calls } = fakeDeps({ record: { plan: 'pro', status: 'active', stripe_customer_id: 'cus_1' } });
    const res = makeRes();
    await createSubscriptionPortal(deps)(makeReq(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.url, 'https://billing.stripe.com/p/session/x');
    assert.equal(calls.portal[0].customer, 'cus_1');
  });

  test('sin cliente de Stripe todavía: 409', async () => {
    const { deps } = fakeDeps();
    const res = makeRes();
    await createSubscriptionPortal(deps)(makeReq(), res);
    assert.equal(res.statusCode, 409);
  });
});

describe('rutas', () => {
  const router = require('../routes/company');
  const names = (chain) => chain.map((fn) => fn.name);

  test('GET /subscription exige sesión', () => {
    const chain = names(effectiveChain(router, 'get', '/subscription'));
    assert.ok(chain.includes('validateJWT'));
    assert.ok(chain.includes('checkTokenVersion'));
  });

  const source = require('node:fs').readFileSync(require.resolve('../routes/company'), 'utf8');
  for (const [path, handler] of [['/subscription/checkout', 'createCheckout'], ['/subscription/portal', 'createPortal']]) {
    test(`POST ${path} exige sesión y billing:update`, () => {
      const chain = names(effectiveChain(router, 'post', path));
      assert.ok(chain.includes('validateJWT'));
      assert.ok(chain.includes('checkTokenVersion'));
      assert.ok(
        source.includes(`router.post("${path}", validateJWT, checkTokenVersion, authorizeMongoPermission("billing", "update"), ${handler});`)
      );
    });
  }
});
