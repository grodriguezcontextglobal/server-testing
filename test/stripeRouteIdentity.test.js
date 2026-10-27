'use strict';

/**
 * Stripe Fase 2 (FedRAMP A8 · AC-3, 2026-10-27): toda ruta de /api/stripe
 * exige sesión o token de consumidor, salvo crear un payment intent y el alta
 * de compañía.
 *
 * Regla (decisión del 2026-10-27): suscripciones, cobros, reembolsos y
 * capturas exigen sesión; crear un payment intent no, porque también se hace
 * desde sesiones no autenticadas, pero desde la app de consumidor lleva
 * consumerTokenGate (vuelve a validar el token del consumidor).
 *
 * El trinquete de fedrampA2RouteIdentity no lo ve: cuenta optionalJWT como
 * identidad, y en este router va en un router.use para todas las rutas. Pero
 * optionalJWT solo lee la sesión si viene; no la exige.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const router = require(path.resolve(__dirname, '../routes/stripe'));

// El alta de compañía (dashboard: RegisterCompany y /register/connected-account,
// en NoAuthRoutes) corre antes de que haya sesión.
const STRIPE_PUBLIC = {
  'POST /company-account-stripe/': 'alta de compañía: busca si ya tiene cliente de Stripe',
  'POST /new-company-account': 'alta de compañía: crea el cliente de Stripe',
  'POST /accounts': 'alta de compañía: crea la cuenta conectada',
  'POST /account_link': 'alta de compañía: enlace de onboarding de la cuenta conectada',
};

const routes = router.stack
  .filter((l) => l.route)
  .flatMap((l) =>
    Object.keys(l.route.methods).map((m) => ({
      key: `${m.toUpperCase()} ${l.route.path}`,
      names: l.route.stack.map((s) => s.handle.name),
    }))
  );

test('toda ruta de Stripe exige sesión (validateJWT + checkTokenVersion) o token de consumidor', () => {
  const open = routes
    .filter(({ key }) => !(key in STRIPE_PUBLIC))
    .filter(({ names }) => {
      const session = names.includes('validateJWT') && names.includes('checkTokenVersion');
      return !session && !names.includes('consumerTokenGate');
    })
    .map(({ key }) => key);
  assert.deepEqual(open, [], 'Ruta de Stripe sin sesión: añade requireSession, o justifícala en STRIPE_PUBLIC.');
});

test('crear un payment intent: sin sesión de staff, con el token del consumidor validado', () => {
  for (const key of ['POST /create-payment-intent', 'POST /create-payment-intent-customized', 'POST /create-payment-intent-subscription']) {
    const { names } = routes.find((r) => r.key === key);
    assert.ok(names.includes('consumerTokenGate'), `${key}: falta consumerTokenGate`);
    assert.ok(!names.includes('validateJWT'), `${key}: no debe exigir sesión de staff`);
  }
});

test('STRIPE_PUBLIC no tiene entradas viejas', () => {
  const keys = new Set(routes.map((r) => r.key));
  const stale = Object.keys(STRIPE_PUBLIC).filter((k) => !keys.has(k));
  assert.deepEqual(stale, []);
  for (const k of Object.keys(STRIPE_PUBLIC)) {
    const { names } = routes.find((r) => r.key === k);
    assert.ok(!names.includes('validateJWT'), `${k} ya exige sesión: sácala de STRIPE_PUBLIC`);
  }
});
