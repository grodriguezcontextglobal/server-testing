'use strict';

/**
 * PATCH /api/company/update-company/:id (AC-3, AC-6; 2026-11-09): solo la
 * compañía del contexto, y solo los campos permitidos.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { pickCompanyUpdate, sanitizeConnectedAccount } = require('../helpers/companyUpdateFields');
const { createUpdatingCompany } = require('../controller/company');

const A = '64b000000000000000000001';
const B = '64b000000000000000000002';

const makeRes = () => {
  const res = { statusCode: 200 };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
};

const makeReq = ({ id = A, header = A, body = {}, uid = 'u1' } = {}) => ({
  uid,
  params: { id },
  body,
  headers: { 'x-company-id': header },
  header(name) {
    return this.headers[name.toLowerCase()];
  },
});

function setup({ company = { _id: A, company_name: 'Acme', stripe_connected_account: { test: 'acct_1', live: null } }, superUser = false } = {}) {
  const calls = { updates: [], warns: [] };
  const handler = createUpdatingCompany({
    CompanyModel: {
      findById: async () => company,
      findByIdAndUpdate: async (id, update) => {
        calls.updates.push({ id, update });
        return { ...company, ...update.$set };
      },
    },
    AdminUserModel: { findById: () => ({ select: () => ({ lean: async () => ({ super_user: superUser }) }) }) },
    invalidate: () => {},
    log: { warn: (msg, d) => calls.warns.push({ msg, d }), error: () => {} },
  });
  return { handler, calls };
}

describe('helpers/companyUpdateFields', () => {
  test('pasan los campos que el dashboard edita; el resto se ignora', () => {
    const { update, ignored } = pickCompanyUpdate(
      {
        company_name: 'Acme 2',
        address: { city: 'Miami' },
        phone: { main: '1' },
        website: 'x',
        main_email: 'a@x.com',
        industry: 'Education',
        company_logo: 'https://res.cloudinary.com/x.png',
        email_branding: { enabled: true },
        structure: { a: 'b' },
        roleLabels: { admin: 'Boss' },
        employees: [],
        stripe_customer_id: 'cus_attacker',
        owner: { email: 'evil@x.com' },
        _id: B,
        id: B,
        location: ['x'],
      },
      { stripe_connected_account: { test: null, live: null } }
    );
    assert.deepEqual(Object.keys(update).sort(), [
      'address', 'company_logo', 'company_name', 'email_branding', 'employees', 'industry',
      'main_email', 'phone', 'roleLabels', 'structure', 'website',
    ]);
    assert.deepEqual(ignored.sort(), ['_id', 'id', 'location', 'owner', 'stripe_customer_id']);
  });

  test('cuenta conectada: el mismo acct_ con otra forma se acepta (lo que hace el dashboard)', () => {
    const { value, rejected } = sanitizeConnectedAccount(
      { test: { id: 'acct_1', login_links: { url: 'https://connect.stripe.com/x' } }, live: null },
      { test: 'acct_1', live: null }
    );
    assert.equal(rejected, false);
    assert.deepEqual(value, { test: { id: 'acct_1', login_links: { url: 'https://connect.stripe.com/x' } }, live: null });
  });

  test('cuenta conectada: otro acct_, uno nuevo donde no había, o borrarla: se ignora', () => {
    for (const sent of [
      { test: { id: 'acct_ATTACKER' } },
      { live: 'acct_new' },
      { test: null },
      { id: 'acct_1' }, // forma plana sin test/live
      'acct_1',
    ]) {
      const { value, rejected } = sanitizeConnectedAccount(sent, { test: 'acct_1', live: null });
      assert.equal(value, null, JSON.stringify(sent));
      assert.equal(rejected, true, JSON.stringify(sent));
    }
  });

  test('cuenta conectada sin cambios (la sesión entera de vuelta): ni se escribe ni se marca', () => {
    const r = pickCompanyUpdate(
      { structure: { a: 'b' }, stripe_connected_account: { test: null, live: null } },
      { stripe_connected_account: { test: null, live: null } }
    );
    assert.deepEqual(r.update, { structure: { a: 'b' } });
    assert.deepEqual(r.ignored, []);
  });
});

describe('updatingCompany', () => {
  test('la compañía del contexto: escribe solo lo permitido con $set y avisa de lo ignorado', async () => {
    const { handler, calls } = setup();
    const res = makeRes();
    await handler(makeReq({ body: { structure: { a: 'b' }, stripe_customer_id: 'cus_x' } }), res);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(calls.updates[0].update, { $set: { structure: { a: 'b' } } });
    assert.deepEqual(res.body.ignored_fields, ['stripe_customer_id']);
    assert.equal(calls.warns[0].msg, 'update-company: fields ignored');
  });

  test('otra compañía que la del contexto: 403 y no escribe', async () => {
    const { handler, calls } = setup();
    const res = makeRes();
    await handler(makeReq({ id: B, header: A, body: { company_name: 'pwned' } }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(calls.updates.length, 0);
  });

  test('sin contexto de compañía: 403', async () => {
    const { handler, calls } = setup();
    const res = makeRes();
    await handler(makeReq({ header: null, body: { company_name: 'x' } }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(calls.updates.length, 0);
  });

  test('un super_user de la plataforma sí puede editar otra compañía', async () => {
    const { handler, calls } = setup({ superUser: true });
    const res = makeRes();
    await handler(makeReq({ id: B, header: A, body: { company_name: 'Fixed' } }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(calls.updates.length, 1);
  });

  test('nada editable: 400 con los campos ignorados', async () => {
    const { handler, calls } = setup();
    const res = makeRes();
    await handler(makeReq({ body: { owner: {} } }), res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body.ignored_fields, ['owner']);
    assert.equal(calls.updates.length, 0);
  });

  test('compañía inexistente: 404', async () => {
    const { handler } = setup({ company: null });
    const res = makeRes();
    await handler(makeReq({ body: { company_name: 'x' } }), res);
    assert.equal(res.statusCode, 404);
  });
});
