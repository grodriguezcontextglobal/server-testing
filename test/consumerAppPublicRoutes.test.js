'use strict';

/**
 * Rutas que la app del consumidor (app.devitrak.net, repo devitrak) llama SIN
 * sesión. La app no tiene login ni interceptor de token: si una de estas rutas
 * pasa a exigir validateJWT, la app se rompe en producción.
 *
 * Lista confirmada por Gustavo el 2026-10-21, más las del registro de un
 * consumidor nuevo (ConsumerInitialForm.jsx) y la de sus equipos asignados.
 * Al cerrar un router (FedRAMP P1.1), estas van en su PUBLIC_ROUTES o en un
 * carril de dos vías (staff con sesión / anónimo acotado), nunca detrás del
 * cierre. Si la app deja de llamar a una, se quita de aquí a la vez.
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONSUMER_APP_ROUTES = [
  // [router, método, ruta dentro del router, dónde la llama la app]
  ['routes/auth', 'PATCH', '/:id', 'perfil y registro (4 sitios)'],
  ['routes/auth', 'GET', '/:id', 'perfil'],
  ['routes/auth', 'POST', '/user-query', 'ConsumerInitialForm: ¿existe el consumidor?'],
  ['routes/auth', 'POST', '/new', 'ConsumerInitialForm: alta'],
  ['mysql/routes/consumers', 'POST', '/new_consumer', 'ConsumerInitialForm: alta en MySQL'],
  ['routes/stripe', 'GET', '/payment_intents/:id', 'historial de pagos'],
  ['routes/stripe', 'POST', '/create-payment-intent', 'pago del depósito'],
  ['routes/stripe', 'POST', '/customer', 'ConsumerInitialForm: cliente de Stripe'],
  ['routes/transaction', 'POST', '/transaction', 'lista de transacciones'],
  ['routes/transaction', 'POST', '/save-transaction', 'guardar la transacción'],
  ['routes/company', 'POST', '/event-consumer-signatures', 'firma del consumidor'],
  ['routes/post', 'POST', '/posts', 'publicaciones del evento'],
  ['routes/document', 'POST', '/download/documentUrl', 'MainDocument.jsx:49'],
  ['routes/nodeMailer', 'POST', '/confirmation-account', 'ConsumerInitialForm: correo de confirmación'],
  ['routes/receivers', 'POST', '/receiver-assigned-list', 'OrderFormat.jsx: equipos asignados'],
  ['routes/event', 'POST', '/event-list', 'Home, DeviceSelection, AuthenticationLogin: carga el evento por _id'],
];

const root = path.resolve(__dirname, '..');

const { effectiveChain } = require('./helpers/effectiveChain');

for (const [file, method, routePath, where] of CONSUMER_APP_ROUTES) {
  test(`app del consumidor: ${method} ${file.split('/').pop()}${routePath} sigue sin exigir sesión (${where})`, () => {
    const router = require(path.join(root, file));
    const chain = effectiveChain(router, method, routePath);
    assert.ok(chain, `la ruta ${method} ${routePath} tiene que existir en ${file}`);
    const names = chain.map((h) => h.name);
    assert.ok(
      !names.includes('validateJWT') && !names.includes('checkTokenVersion'),
      `${method} ${routePath} exige sesión (${names.join(' > ')}): rompe la app del consumidor`
    );
  });
}

test('app del consumidor: /api/company/event-consumer-signatures está exenta de requireCompanyAuth', () => {
  const { isPublicRoute } = require(path.join(root, 'middlewares/companyAuth'));
  assert.ok(isPublicRoute({ path: '/event-consumer-signatures' }));
});

test('app del consumidor: /api/cloudinary (upload-image) se monta sin sesión', () => {
  const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const line = index.split('\n').find((l) => l.includes('app.use("/api/cloudinary"'));
  assert.ok(line, 'falta el montaje de /api/cloudinary');
  assert.doesNotMatch(line, /validateJWT|checkTokenVersion/);
});
