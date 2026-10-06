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
  ['../routes/staff', 'post', '/force-logout'],
  ['../routes/admin', 'patch', '/profile/:id'],
];

for (const [mod, method, routePath] of cases) {
  test(`${mod.replace('../', '')}: ${method.toUpperCase()} ${routePath} exige validateJWT`, () => {
    const h = handlers(require(mod), method, routePath);
    assert.ok(h, 'la ruta no está registrada');
    assert.ok(h.includes(validateJWT), 'falta validateJWT');
  });
}
