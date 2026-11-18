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
      'address', 'company_logo', 'company_name', 'email_branding', 'industry',
      'main_email', 'phone', 'roleLabels', 'structure', 'website',
    ]);
    // `employees: []` no pide nada, así que no se ignora nada: no aparece aquí.
    assert.deepEqual(ignored.sort(), ['_id', 'id', 'location', 'owner', 'stripe_customer_id']);
  });

  // AC-2, 2026-11-17: la plantilla de staff no se REESCRIBE por esta ruta.
  // Desde el 2026-11-18 sí se puede AÑADIR a alguien, porque el alta de staff
  // no tenía otra puerta y quitarla rompió producción — ver el bloque de abajo.
  test('un alta sin roleType válido no entra', () => {
    const { update, ignored } = pickCompanyUpdate(
      {
        company_name: 'Acme',
        employees: [{ user: 'evil@x.com', super_user: true, active: true }],
      },
      {}
    );
    assert.deepEqual(Object.keys(update), ['company_name']);
    assert.ok(ignored.includes('employees'));
  });

  // 2026-11-18. El alta de staff es crear la entrada `Pending` en `employees`,
  // y es el primer paso obligatorio: sin ella,
  // POST /api/nodemailer/new_invitation responde "There is no pending
  // invitation" (controller/registration.js:498). Quitar `employees` de la
  // lista el 11-17 dejó el alta sin ninguna puerta.
  describe('alta de staff por update-company (sólo añadir)', () => {
    const { sanitizeEmployees } = require('../helpers/companyUpdateFields');

    const OWNER = {
      user: 'owner@acme.com', firstName: 'O', lastName: 'Wner',
      roleType: 'root_admin', super_user: true, status: 'active', active: true,
    };

    test('el cuerpo del dashboard —plantilla entera más uno nuevo— añade sólo el nuevo', () => {
      const { value, rejected, added } = sanitizeEmployees(
        [OWNER, { user: 'nuevo@devitrak.com', firstName: 'G', lastName: 'R', roleType: 'admin' }],
        [OWNER]
      );
      assert.equal(rejected, false);
      assert.deepEqual(added, ['nuevo@devitrak.com']);
      assert.equal(value.length, 2);
      // El que ya estaba se copia del documento, no del cuerpo.
      assert.deepEqual(value[0], OWNER);
      assert.equal(value[1].user, 'nuevo@devitrak.com');
    });

    test('al nuevo lo decide el servidor: Pending, sin super_user y activo', () => {
      const { value } = sanitizeEmployees(
        [{
          user: 'nuevo@devitrak.com', roleType: 'admin',
          // Todo esto viene del cuerpo y no debe sobrevivir.
          super_user: true, status: 'Confirmed', active: false,
          userId: '66cdf26906fd8fd5e9b13eed', _id: 'x',
        }],
        []
      );
      assert.equal(value[0].super_user, false);
      assert.equal(value[0].status, 'Pending');
      assert.equal(value[0].active, true);
      assert.equal(value[0].userId, undefined, 'el userId lo pone acceptInvitation');
      assert.equal(value[0]._id, undefined);
    });

    // El agujero de AC-2 que motivó quitar el campo.
    test('no se puede ascender ni cambiar de rol a quien ya está', () => {
      const { value, rejected } = sanitizeEmployees(
        [{ ...OWNER, roleType: 'admin' },
         { user: 'staff@acme.com', roleType: 'assistant', super_user: true }],
        [OWNER, { user: 'staff@acme.com', roleType: 'assistant', super_user: false, active: true }]
      );
      assert.equal(rejected, true);
      assert.equal(value, null, 'nada que añadir, así que no se escribe nada');
    });

    test('tampoco se puede dar de baja a nadie omitiéndolo', () => {
      const { value, rejected, added } = sanitizeEmployees(
        [{ user: 'nuevo@devitrak.com', roleType: 'admin' }],
        [OWNER]
      );
      assert.equal(rejected, false);
      assert.deepEqual(added, ['nuevo@devitrak.com']);
      assert.equal(value.length, 2, 'el que no venía en el cuerpo sigue ahí');
      assert.equal(value[0].user, OWNER.user);
    });

    test('un rol inventado no entra', () => {
      const { value, rejected } = sanitizeEmployees(
        [{ user: 'nuevo@devitrak.com', roleType: 'god_mode' }], []
      );
      assert.equal(value, null);
      assert.equal(rejected, true);
    });

    test('el email se compara normalizado, así que no se duplica a nadie', () => {
      const { value, rejected } = sanitizeEmployees(
        [{ user: '  OWNER@Acme.com ', roleType: 'admin' }], [OWNER]
      );
      assert.equal(value, null, 'ya está: no se añade otra vez');
      assert.equal(rejected, true, 'y además pedía cambiarle el rol');
    });

    test('lo que no es un array no toca nada', () => {
      for (const sent of [null, undefined, 'x', 42, {}]) {
        const { value, rejected } = sanitizeEmployees(sent, [OWNER]);
        assert.equal(value, null, String(sent));
        assert.equal(rejected, true, String(sent));
      }
    });
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
