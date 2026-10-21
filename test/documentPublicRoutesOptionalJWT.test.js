'use strict';

// Las rutas de /api/document que ve o firma alguien sin sesión (consumidor,
// tutor, staff desde la app) pasan por optionalJWT, y NO por validateJWT:
// exigir token rompería esos flujos públicos.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateJWT } = require('../middlewares/validate-jwt');
const { optionalJWT } = require('../middlewares/optionalJWT');
const router = require('../routes/document');

function handlers(method, routePath) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method],
  );
  return layer ? layer.route.stack.map((l) => l.handle) : null;
}

// Desde 2026-10-21 (FedRAMP P1.1) ya no están aquí: las tres de crear una
// verificación (*/signed_document, el dashboard las llama con sesión) y
// member/check_signed_document y member/signing_document (nadie las llama).
// Ver test/documentRouterGuards.test.js y la clasificación del 2026-10-14.
const PUBLIC_ROUTES = [
  ['get', '/:id'],
  ['get', '/download/:documentId/:userId'],
  ['post', '/download/documentUrl'],
  ['post', '/verification/staff_member/check_signed_document'],
  ['patch', '/verification/staff_member/signing_document'],
  ['post', '/verification/consumer_member/check_signed_document'],
  ['patch', '/verification/consumer_member/signing_document'],
];

for (const [method, routePath] of PUBLIC_ROUTES) {
  test(`document: ${method.toUpperCase()} ${routePath} pasa por optionalJWT y sigue siendo pública`, () => {
    const h = handlers(method, routePath);
    assert.ok(h, 'la ruta no está registrada');
    assert.equal(h[0], optionalJWT, 'optionalJWT debe ir primero');
    assert.ok(!h.includes(validateJWT), 'una ruta pública no puede exigir token');
  });
}

// GET /:id comparte path con PATCH/PUT/DELETE /:id, que sí exigen sesión: el
// optionalJWT de la lectura no puede haber sustituido a validateJWT en ellas.
for (const method of ['patch', 'put', 'delete']) {
  test(`document: ${method.toUpperCase()} /:id sigue exigiendo validateJWT`, () => {
    const h = handlers(method, '/:id');
    assert.ok(h.includes(validateJWT));
    assert.ok(!h.includes(optionalJWT));
  });
}

test('optionalJWT nunca rechaza: sin token, o con token inválido, sigue como público', () => {
  for (const token of [undefined, 'not-a-jwt']) {
    const req = { header: (name) => (name === 'x-token' ? token : undefined), originalUrl: '/api/document/1' };
    let called = false;
    optionalJWT(req, {}, () => { called = true; });
    assert.ok(called, `next() con token=${token}`);
    assert.equal(req.authContext.isAuthenticated, false);
    assert.equal(req.uid, undefined);
  }
});
