'use strict';

// Comprueba en el router que las cuatro rutas pasan por validateJWT antes del
// handler. Los controllers verifican la compañía, pero sin token no hay req.uid.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateJWT } = require('../middlewares/validate-jwt');

function handlers(router, method, routePath) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method],
  );
  return layer ? layer.route.stack.map((l) => l.handle) : null;
}

const cases = [
  ['../routes/document', 'patch', '/:id'],
  ['../routes/document', 'put', '/:id'], // lo que llama EditDocument.jsx
  ['../routes/document', 'delete', '/:id'],
  // force-logout ya no: desde 2026-10-12 es anónima desde el login (token opcional).
  ['../routes/admin', 'patch', '/profile/:id'],
];

for (const [mod, method, routePath] of cases) {
  test(`${mod.replace('../', '')}: ${method.toUpperCase()} ${routePath} exige validateJWT`, () => {
    const h = handlers(require(mod), method, routePath);
    assert.ok(h, 'la ruta no está registrada');
    assert.ok(h.includes(validateJWT), 'falta validateJWT');
  });
}

// PATCH /api/staff/edit-admin/:id: el propio usuario con campos personales
// (p. ej. `{ online: false }` al cerrar sesión) no necesita staff:update.
const editAdminGate = () => handlers(require('../routes/staff'), 'patch', '/edit-admin/:id')[2];
const runGate = (req) =>
  new Promise((resolve) => {
    const res = { status: (c) => ({ json: (b) => resolve({ code: c, body: b }) }) };
    Promise.resolve(editAdminGate()(req, res, () => resolve({ next: true })));
  });
const U = '6a83688d76570c9d6edc88bd';

test('edit-admin: el propio usuario cambia `online` sin staff:update', async () => {
  const r = await runGate({ uid: U, params: { id: U }, body: { online: false }, headers: {}, header: () => undefined });
  assert.deepEqual(r, { next: true });
});

test('edit-admin: el propio usuario con un campo no personal (super_user) pasa por staff:update', async () => {
  // Sin uid el permiso responde 401 sin tocar la base: basta para ver que NO se saltó.
  const r = await runGate({ uid: undefined, params: { id: 'undefined' }, body: { online: false, super_user: true }, headers: {}, header: () => undefined });
  assert.equal(r.code, 401);
});

test('edit-admin: editar a otro sigue pasando por staff:update', async () => {
  const r = await runGate({ uid: undefined, params: { id: U }, body: { online: false }, headers: {}, header: () => undefined });
  assert.equal(r.code, 401);
});
