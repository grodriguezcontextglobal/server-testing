'use strict';

/**
 * Stripe Fase 0.1 (2026-10-19): capturar, liberar o reembolsar solo pagos de la
 * compañía del contexto. Una sola cuenta de Stripe para todas: sin esto, un staff
 * de la compañía A con transaction:update movía pagos de la compañía B.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRequirePaymentOwnership } = require('../middlewares/requirePaymentOwnership');

const CO_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CO_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const PI_A = 'pi_3AAAAAAAAAAAAAAAAAAAAAAAA';
const PI_B = 'pi_3BBBBBBBBBBBBBBBBBBBBBBBB';
const PI_ORPHAN = 'pi_3OOOOOOOOOOOOOOOOOOOOOOOO';
const PI_META_A = 'pi_3MMMMMMMMMMMMMMMMMMMMMMMM';
const PI_GONE = 'pi_3GGGGGGGGGGGGGGGGGGGGGGGG';

const records = { [PI_A]: [CO_A], [PI_B]: [CO_B] };
const stripePIs = { [PI_ORPHAN]: { metadata: {} }, [PI_META_A]: { metadata: { company_id: CO_A } } };
let stripeCalls = 0;

const factory = createRequirePaymentOwnership({
  findOwners: async (id) => records[id] ?? [],
  retrievePaymentIntent: async (id) => {
    stripeCalls += 1;
    if (stripePIs[id]) return stripePIs[id];
    throw Object.assign(new Error('No such payment_intent'), { code: 'resource_missing', statusCode: 404 });
  },
  findAdmin: async (uid) => ({ platform: { super_user: true }, staff: { super_user: false } })[uid] ?? null,
  resolveCompany: (req) => req.headers['x-company-id'] ?? null,
});
const mw = factory((req) => req.body?.paymentIntent);

const run = async ({ uid = 'staff', company = CO_A, paymentIntent }) => {
  const req = { uid, headers: company ? { 'x-company-id': company } : {}, body: { paymentIntent } };
  const res = {};
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  let passed = false;
  await mw(req, res, () => { passed = true; });
  return { passed, code: res.code, req };
};

test('pago de la propia compañía → sigue', async () => {
  const r = await run({ paymentIntent: PI_A });
  assert.equal(r.passed, true);
  assert.deepEqual(r.req.paymentOwnership.owners, [CO_A]);
});

test('pago de OTRA compañía → 404 (sin confirmar que existe)', async () => {
  const r = await run({ paymentIntent: PI_B });
  assert.equal(r.passed, false);
  assert.equal(r.code, 404);
});

test('sin cabecera de compañía, un pago con dueño no se mueve', async () => {
  const r = await run({ company: null, paymentIntent: PI_A });
  assert.equal(r.code, 404);
});

test('sin registros: se usa metadata.company_id del PaymentIntent', async () => {
  stripeCalls = 0;
  assert.equal((await run({ paymentIntent: PI_META_A })).passed, true);
  assert.equal(stripeCalls, 1);
  assert.equal((await run({ company: CO_B, paymentIntent: PI_META_A })).code, 404);
});

test('con registros no se consulta a Stripe', async () => {
  stripeCalls = 0;
  await run({ paymentIntent: PI_A });
  assert.equal(stripeCalls, 0);
});

test('sin dueño en ningún sitio → 403, salvo super_user de plataforma', async () => {
  assert.equal((await run({ paymentIntent: PI_ORPHAN })).code, 403);
  const r = await run({ uid: 'platform', paymentIntent: PI_ORPHAN });
  assert.equal(r.passed, true);
  assert.equal(r.req.paymentOwnership.platformSuperUser, true);
});

test('el super_user de plataforma mueve pagos de cualquier compañía, y queda marcado', async () => {
  const r = await run({ uid: 'platform', company: CO_A, paymentIntent: PI_B });
  assert.equal(r.passed, true);
  assert.deepEqual(r.req.paymentOwnership.owners, [CO_B]);
});

test('pago que no existe en Stripe ni en registros → 404; sin id → 400', async () => {
  assert.equal((await run({ paymentIntent: PI_GONE })).code, 404);
  assert.equal((await run({ paymentIntent: undefined })).code, 400);
});

// ── rutas: las 8 que mueven dinero llevan la comprobación ───────────────────

const handlersOf = (method, routePath) => {
  const router = require('../routes/stripe');
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route.methods[method]);
  assert.ok(layer, `${routePath} debe existir`);
  return layer.route.stack.map((l) => l.handle);
};
const hasOwnership = (handlers) => handlers.some((h) => h.toString().includes('defaultFactory'));

for (const routePath of [
  '/payment-intents/:id/capture', '/payment-intents/:id/cancel',
  '/internal/payment-intents/:id/capture', '/internal/payment-intents/:id/cancel',
  '/refund', '/partial-refund', '/internal/refund', '/internal/partial-refund',
]) {
  test(`routes/stripe.js: ${routePath} comprueba que el pago es de la compañía`, () => {
    const handlers = handlersOf('post', routePath);
    assert.ok(hasOwnership(handlers));
    // y antes del controlador
    const idx = handlers.findIndex((h) => h.toString().includes('defaultFactory'));
    assert.ok(idx < handlers.length - 1);
  });
}

test('capture/cancel: el pi_ de la URL y el del body tienen que coincidir (422)', () => {
  const [mwSame] = handlersOf('post', '/payment-intents/:id/capture').filter((h) => h.toString().includes('must match'));
  assert.ok(mwSame);
  const res = {};
  res.status = (c) => { res.code = c; return res; };
  res.json = () => res;
  let passed = false;
  mwSame({ params: { id: PI_A }, body: { id: PI_B } }, res, () => { passed = true; });
  assert.equal(res.code, 422);
  assert.equal(passed, false);
  mwSame({ params: { id: PI_A }, body: { id: PI_A } }, res, () => { passed = true; });
  assert.equal(passed, true);
});
