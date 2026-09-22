'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Regresión: el frontend a veces manda connectedAccountId como el objeto
// completo de la cuenta de Stripe ({ id: 'acct_...', object: 'account', ... })
// en vez del string plano. stripeCompanyAccountUpdate debe extraer el id en
// ambos casos antes de llamar a stripe.accounts.update.

const stripeClientPath = require.resolve('../helpers/stripeClient');
const controllerPath = require.resolve('../controller/stripe');

function loadControllerWithStubbedStripe(accountsUpdate) {
  delete require.cache[stripeClientPath];
  delete require.cache[controllerPath];

  require.cache[stripeClientPath] = {
    id: stripeClientPath,
    filename: stripeClientPath,
    loaded: true,
    exports: {
      stripe: { accounts: { update: accountsUpdate } },
      runStripeMutation: (thunk) => thunk(),
      createRunStripeMutation: () => (thunk) => thunk(),
      isStripeInfraFailure: () => false,
    },
  };

  const controller = require(controllerPath);

  delete require.cache[stripeClientPath];
  delete require.cache[controllerPath];

  return controller;
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('stripeCompanyAccountUpdate: acepta connectedAccountId como string', async () => {
  let calledWith = null;
  const controller = loadControllerWithStubbedStripe(async (id, payload) => {
    calledWith = id;
    return { id, ...payload };
  });

  const req = { body: { connectedAccountId: 'acct_123', company_email: 'a@b.com' } };
  const res = mockRes();
  await controller.stripeCompanyAccountUpdate(req, res);

  assert.equal(calledWith, 'acct_123');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('stripeCompanyAccountUpdate: extrae el id cuando connectedAccountId llega como objeto', async () => {
  let calledWith = null;
  const controller = loadControllerWithStubbedStripe(async (id, payload) => {
    calledWith = id;
    return { id, ...payload };
  });

  const req = {
    body: {
      connectedAccountId: { id: 'acct_456', object: 'account' },
      company_email: 'a@b.com',
    },
  };
  const res = mockRes();
  await controller.stripeCompanyAccountUpdate(req, res);

  assert.equal(calledWith, 'acct_456');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('stripeCompanyAccountUpdate: responde 400 si no hay connectedAccountId', async () => {
  let called = false;
  const controller = loadControllerWithStubbedStripe(async () => { called = true; });

  const req = { body: { company_email: 'a@b.com' } };
  const res = mockRes();
  await controller.stripeCompanyAccountUpdate(req, res);

  assert.equal(called, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('stripeCompanyAccountUpdate: responde 400 si connectedAccountId es un objeto sin id', async () => {
  let called = false;
  const controller = loadControllerWithStubbedStripe(async () => { called = true; });

  const req = { body: { connectedAccountId: { object: 'account' }, company_email: 'a@b.com' } };
  const res = mockRes();
  await controller.stripeCompanyAccountUpdate(req, res);

  assert.equal(called, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});
