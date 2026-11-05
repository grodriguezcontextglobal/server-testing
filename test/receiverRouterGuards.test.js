'use strict';

/**
 * /api/receiver deniega por defecto (FedRAMP P1.1 · AC-3, 2026-10-21).
 *
 *   - Todas las rutas pasan por validateJWT + checkTokenVersion a nivel de
 *     router, salvo las de PUBLIC_ROUTES, registradas antes.
 *   - POST /receiver-assigned-list tiene dos carriles: sesión de staff como
 *     siempre; anónimo solo con { user, eventSelected } como texto; dashboard
 *     sin sesión, 401.
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let staffSession = false;
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stub('helpers/consumerUserFilter.js', {
  isStaffSession: async () => staffSession,
  isStaffOrigin: (req) => req.headers?.origin === 'https://admin.devitrak.net',
});

const router = require('../routes/receivers');
const { PUBLIC_ROUTES } = router;

const denyIndex = router.stack.findIndex(
  (l) => !l.route && l.handle.name === 'validateJWT'
);
const routes = router.stack
  .map((layer, index) => ({ layer, index }))
  .filter(({ layer }) => layer.route)
  .flatMap(({ layer, index }) =>
    Object.keys(layer.route.methods).map((m) => ({
      key: `${m.toUpperCase()} ${layer.route.path}`,
      index,
      chain: layer.route.stack.map((l) => l.handle),
    }))
  );

test('el router monta validateJWT y checkTokenVersion para todo lo que viene después', () => {
  assert.ok(denyIndex >= 0, 'falta router.use(validateJWT, ...)');
  assert.equal(router.stack[denyIndex + 1]?.handle.name, 'checkTokenVersion');
});

test('toda ruta queda detrás del cierre salvo la lista pública, que va antes', () => {
  const before = routes.filter((r) => r.index < denyIndex).map((r) => r.key);
  assert.deepEqual(before.sort(), [...PUBLIC_ROUTES].sort());
  assert.ok(routes.length >= 25, `se esperaban 25+ rutas, hay ${routes.length}`);
});

test('no hay rutas registradas dos veces', () => {
  const keys = routes.map((r) => r.key);
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
});

// ─── carriles de POST /receiver-assigned-list ───────────────────────────────

const lanes = routes.find((r) => r.key === 'POST /receiver-assigned-list').chain.find((h) => h.name === 'assignedListLanes');

function run(body, headers = {}) {
  const req = { body, headers, header: (n) => headers[n.toLowerCase()] };
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  return lanes(req, res, () => { passed = true; }).then(() => ({ req, res, passed }));
}

test('anónimo: solo user y eventSelected; el resto del body se descarta', async () => {
  staffSession = false;
  const { req, passed } = await run({ user: 'a@x.com', eventSelected: 'Fair', company: { $ne: null } });
  assert.ok(passed);
  assert.deepEqual(req.body, { user: 'a@x.com', eventSelected: 'Fair' });
});

test('anónimo sin consumidor o evento, o con operadores en su lugar: 400', async () => {
  staffSession = false;
  for (const body of [{}, { user: 'a@x.com' }, { user: { $ne: null }, eventSelected: 'Fair' }]) {
    const { res, passed } = await run(body);
    assert.equal(passed, false);
    assert.equal(res.code, 400);
  }
});

test('dashboard sin sesión: 401', async () => {
  staffSession = false;
  const { res, passed } = await run({ user: 'a@x.com', eventSelected: 'Fair' }, { origin: 'https://admin.devitrak.net' });
  assert.equal(passed, false);
  assert.equal(res.code, 401);
});

test('con sesión de staff el body pasa entero, como antes', async () => {
  staffSession = true;
  const body = { company: 'C1', 'device.status': true };
  const { req, passed } = await run(body, { origin: 'https://admin.devitrak.net' });
  assert.ok(passed);
  assert.equal(req.body, body);
});

test('POST /api/admin/receiver-assignation exige sesión', () => {
  delete require.cache[path.join(root, 'routes/admin.js')];
  const admin = require('../routes/admin');
  const layer = admin.stack.find((l) => l.route?.path === '/receiver-assignation');
  const names = layer.route.stack.map((l) => l.handle.name);
  assert.ok(names.includes('validateJWT') && names.includes('checkTokenVersion'), names.join(','));
});
