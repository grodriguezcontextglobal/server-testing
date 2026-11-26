'use strict';

/**
 * DC3, tercera tanda: las nueve pestañas de la ficha de un cliente
 * (FRONTEND_console_endpoints_2026-11-25.md §4).
 *
 * Como en la tanda anterior, el ultimo bloque juzga contra el esquema REAL de
 * mongoose y contra la tabla de rutas, porque un doble que yo escribo no puede
 * contradecirme: los dos fallos que se colaron este mes —`$createdAt` sobre un
 * modelo que no lo tiene, y `Event` sin acotar por tipo— pasaban todos sus
 * tests mientras devolvian la respuesta equivocada.
 */

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  COMPANY_TAB_RESOURCES,
  fullName,
  companyActivityRow,
  companyTransactionRow,
  companyEventRow,
  companyInventoryRow,
  memberRow,
  consumerRow,
  staffRow,
  subscriptionBody,
  MERCHANT_NOT_SERVED,
} = require('../helpers/platformCompanyTabs');

const {
  platformCompanyActivity,
  platformCompanyTransactions,
  platformCompanyEvents,
  platformCompanyInventory,
  platformCompanyMembers,
  platformCompanyConsumers,
  platformCompanyStaff,
  platformCompanySubscription,
  platformCompanyMerchant,
  platformAttention,
} = require('../controller/platform');

const UserModel = require('../models/User');
const AdminUserModel = require('../models/AdminUser');
const StaffActivityLogModel = require('../models/StaffActivityLog');

const makeResponse = () => {
  const response = { statusCode: 200, body: null };
  response.status = (code) => { response.statusCode = code; return response; };
  response.json = (body) => { response.body = body; return response; };
  return response;
};

const lean = (value) => ({ lean: async () => value });
const selectLean = (value) => ({ select: () => lean(value) });
const findChain = (value, capture = {}) => (filter) => {
  capture.filter = filter;
  return {
    sort: (s) => { capture.sort = s; return { skip: () => ({ limit: () => lean(value) }) }; },
    lean: async () => value,
  };
};

/** `mongoA` cruza a SQL (id 7); `mongoB` no cruza. */
const CROSSWALK_DEPS = {
  Company: {
    find: () => selectLean([
      { _id: 'mongoA', company_name: 'Acme' },
      { _id: 'mongoB', company_name: 'Beta' },
    ]),
  },
  CompanySubscription: {
    find: () => selectLean([{ company: 'mongoA', sql_company_id: 7 }]),
  },
};

const sqlRows = async (sql) => {
  if (/FROM company_info/.test(sql)) return [[{ company_id: 7, company_name: 'Acme' }]];
  return [[]];
};

// ──────────────────────────────────────────────────── los constructores ────

describe('constructores de fila', () => {
  test('fullName no deja un espacio suelto cuando faltan las dos partes', () => {
    assert.equal(fullName('Ann', 'Lee'), 'Ann Lee');
    assert.equal(fullName('Ann', null), 'Ann');
    assert.equal(fullName(null, null), null);
  });

  // La asimetria del console: correo dentro de la ficha de un cliente,
  // nombre en la lista que cruza clientes.
  test('la transaccion de la ficha SI lleva el correo del consumidor', () => {
    const row = companyTransactionRow({ doc: { _id: 't1', consumerInfo: { email: 'ann@x.test', name: 'Ann' } } });
    assert.equal(row.consumerEmail, 'ann@x.test');
  });

  test('la transaccion no inventa un importe ni un estado', () => {
    const row = companyTransactionRow({ doc: { _id: 't1', type: 'deposit' } });
    assert.equal(row.amountCents, null);
    assert.equal(row.status, null);
    assert.equal(row.type, 'deposit');
  });

  // Un 0 aqui diria "no se ha perdido ningun equipo", que nadie ha comprobado.
  test('el inventario agrupado devuelve lost null, no 0', () => {
    const row = companyInventoryRow({ row: { item_group: 'Radio', total: 10, available: 7, out_now: 3 } });
    assert.equal(row.lost, null);
    assert.equal(row.total, 10);
    assert.equal(row.out, 3);
  });

  test('serialRange no colapsa cuando el grupo tiene un solo serial', () => {
    assert.equal(
      companyInventoryRow({ row: { serial_min: 'AB-001', serial_max: 'AB-001' } }).serialRange,
      'AB-001'
    );
    assert.equal(companyInventoryRow({ row: {} }).serialRange, null);
  });

  // `members_info` no tiene ninguna de estas tres columnas.
  test('el alumno declara null lo que la tabla no guarda', () => {
    const row = memberRow({ row: { member_id: 5, first_name: 'Ann', last_name: 'Lee', email: 'a@x.test' } });
    assert.equal(row.status, null);
    assert.equal(row.joinedAt, null);
    assert.equal(row.devicesOut, null);
    assert.equal(row.name, 'Ann Lee');
  });

  test('un empleado sin cuenta no afirma que no tiene MFA', () => {
    const row = staffRow({ employee: { firstName: 'Ann', email: 'a@x.test' }, account: null });
    assert.equal(row.twoStepEnabled, null, 'null = no tiene cuenta; false diria que la tiene sin MFA');
    assert.equal(row.lastLoginAt, null);
  });

  test('un empleado con cuenta sin MFA si afirma false', () => {
    const row = staffRow({ employee: { email: 'a@x.test' }, account: { mfaEnabled: false, lastLoginAt: null } });
    assert.equal(row.twoStepEnabled, false);
  });

  test('scope distingue los roles de categoria de los de compañia', () => {
    assert.equal(staffRow({ employee: { roleType: 'category_manager' } }).scope, 'category');
    assert.equal(staffRow({ employee: { roleType: 'admin' } }).scope, 'company');
  });

  test('el evento de la ficha no inventa dinero ni equipos sin devolver', () => {
    const row = companyEventRow({ doc: { _id: 'e1', deviceSetup: [1, 2, 3] }, consumersCount: 4 });
    assert.equal(row.revenueCents, null);
    assert.equal(row.devicesNotReturned, null);
    assert.equal(row.devicesAssigned, 3);
    assert.equal(row.consumersCount, 4);
  });

  test('la suscripcion no inventa un precio', () => {
    const body = subscriptionBody({ doc: { plan: 'free', status: 'active' }, limits: { staff: 3 } });
    assert.equal(body.data.priceCents, null);
    assert.equal(body.data.paymentMethodLast4, null);
    assert.equal(body.data.seatsLimit, 3);
  });

  test('son ocho recursos servidos; merchant no esta entre ellos', () => {
    assert.equal(COMPANY_TAB_RESOURCES.length, 8);
    assert.ok(!COMPANY_TAB_RESOURCES.includes('merchant'));
  });
});

// ───────────────────────────────────────────────────────── los handlers ────

describe('GET /companies/:id/activity', () => {
  const deps = (capture = {}) => ({
    ...CROSSWALK_DEPS,
    query: sqlRows,
    StaffActivityLog: {
      countDocuments: async (f) => { capture.count = f; return 1; },
      find: findChain([
        { _id: 'a1', timestamp: new Date('2026-11-24T00:00:00.000Z'), target_model: 'Item', source: 'dashboard' },
      ], capture),
    },
  });

  test('acota por company_id y ordena por timestamp, no por createdAt', async () => {
    const capture = {};
    const response = makeResponse();
    await platformCompanyActivity(deps(capture))({ params: { id: 'mongoA' }, query: {} }, response);
    assert.equal(capture.filter.company_id, 'mongoA');
    assert.equal(capture.sort.timestamp, -1);
    assert.equal(capture.sort.createdAt, undefined);
    assert.equal(response.body.data[0].category, 'inventory');
    assert.equal(response.body.data[0].source, 'dashboard');
  });

  test('category se traduce a los target_model de esa categoria', async () => {
    const capture = {};
    await platformCompanyActivity(deps(capture))(
      { params: { id: 'mongoA' }, query: { category: 'inventory' } }, makeResponse()
    );
    assert.ok(capture.filter.target_model.$in.includes('Item'));
  });

  // Una categoria que no existe no puede filtrar a cero en silencio.
  test('una categoria desconocida se declara y no filtra', async () => {
    const capture = {};
    const response = makeResponse();
    await platformCompanyActivity(deps(capture))(
      { params: { id: 'mongoA' }, query: { category: 'inventado' } }, response
    );
    assert.equal(capture.filter.target_model, undefined);
    assert.equal(response.body.filters.category.applied, null);
    assert.ok(response.body.filters.category.note);
  });

  test('un cliente que no existe es 404', async () => {
    const response = makeResponse();
    await platformCompanyActivity(deps())({ params: { id: 'noexiste' }, query: {} }, response);
    assert.equal(response.statusCode, 404);
  });
});

describe('GET /companies/:id/events', () => {
  const deps = (capture = {}) => ({
    ...CROSSWALK_DEPS,
    query: sqlRows,
    Event: {
      countDocuments: async (f) => { capture.count = f; return 1; },
      find: findChain([
        { _id: 'e1', active: true, eventInfoDetail: { eventName: 'Expo' }, deviceSetup: [1] },
      ], capture),
    },
    User: { aggregate: async () => [{ _id: 'e1', n: 12 }] },
  });

  // El mismo filtro que la lista entre clientes: la coleccion guarda leases.
  test('acota por type=event y por company_id', async () => {
    const capture = {};
    await platformCompanyEvents(deps(capture))({ params: { id: 'mongoA' }, query: {} }, makeResponse());
    assert.equal(capture.filter.type, 'event');
    assert.equal(capture.filter.company_id, 'mongoA');
    assert.equal(capture.count.type, 'event');
  });

  test('consumersCount sale de event_providers, contado para toda la pagina', async () => {
    const response = makeResponse();
    await platformCompanyEvents(deps())({ params: { id: 'mongoA' }, query: {} }, response);
    assert.equal(response.body.data[0].consumersCount, 12);
  });
});

describe('GET /companies/:id/inventory', () => {
  const deps = (capture = {}) => ({
    ...CROSSWALK_DEPS,
    query: async (sql, params) => {
      if (/FROM company_info/.test(sql)) return [[{ company_id: 7, company_name: 'Acme' }]];
      (capture.sql = capture.sql || []).push({ sql, params });
      if (/COUNT\(DISTINCT/.test(sql)) return [[{ groups: 2, total: 10, available: 7, out_now: 3 }]];
      return [[{ item_group: 'Radio', category_name: 'Audio', total: 10, available: 7, out_now: 3 }]];
    },
  });

  test('filtra por el id SQL del cliente', async () => {
    const capture = {};
    await platformCompanyInventory(deps(capture))({ params: { id: 'mongoA' }, query: {} }, makeResponse());
    for (const call of capture.sql) {
      assert.match(call.sql, /company_id = \?/, 'toda consulta lleva el filtro de cliente');
      assert.equal(call.params[0], 7);
    }
  });

  // Sin filtro devolveria el inventario de TODOS los clientes.
  test('un cliente sin cruce a SQL devuelve lista vacia, no el inventario de todos', async () => {
    const capture = {};
    const response = makeResponse();
    await platformCompanyInventory(deps(capture))({ params: { id: 'mongoB' }, query: {} }, response);
    assert.deepEqual(response.body.data, []);
    assert.equal(response.body.total, 0);
    assert.equal(capture.sql, undefined, 'no se consulta el inventario sin id de cliente');
  });
});

describe('GET /companies/:id/members', () => {
  const deps = (capture = {}) => ({
    ...CROSSWALK_DEPS,
    query: async (sql, params) => {
      if (/FROM company_info/.test(sql)) return [[{ company_id: 7, company_name: 'Acme' }]];
      (capture.sql = capture.sql || []).push({ sql, params });
      if (/COUNT\(\*\)/.test(sql)) return [[{ total: 3 }]];
      return [[{ member_id: 5, external_id: 'S-5', first_name: 'Ann', last_name: 'Lee', email: 'a@x.test' }]];
    },
  });

  test('toda consulta lleva company_id', async () => {
    const capture = {};
    await platformCompanyMembers(deps(capture))({ params: { id: 'mongoA' }, query: {} }, makeResponse());
    for (const call of capture.sql) {
      assert.match(call.sql, /m\.company_id = \?/);
      assert.equal(call.params[0], 7);
    }
  });

  test('sin cruce a SQL no se consulta nada', async () => {
    const capture = {};
    const response = makeResponse();
    await platformCompanyMembers(deps(capture))({ params: { id: 'mongoB' }, query: {} }, response);
    assert.equal(response.body.total, 0);
    assert.equal(capture.sql, undefined);
  });
});

describe('GET /companies/:id/consumers', () => {
  const deps = (capture = {}) => ({
    ...CROSSWALK_DEPS,
    query: sqlRows,
    User: {
      countDocuments: async () => 1,
      find: findChain([{ _id: 'u1', name: 'Ann', lastName: 'Lee', email: 'a@x.test' }], capture),
    },
    Transaction: { aggregate: async (p) => { capture.agg = p; return [{ _id: 'a@x.test', n: 4 }]; } },
  });

  // `consumer_info` en SQL no tiene columna de compañia.
  test('sale de company_providers, no de la tabla SQL', async () => {
    const capture = {};
    const response = makeResponse();
    await platformCompanyConsumers(deps(capture))({ params: { id: 'mongoA' }, query: {} }, response);
    assert.equal(capture.filter.company_providers, 'mongoA');
    assert.equal(response.body.data[0].transactionsCount, 4);
  });

  test('no inventa un estado ni una ultima visita', async () => {
    const response = makeResponse();
    await platformCompanyConsumers(deps())({ params: { id: 'mongoA' }, query: {} }, response);
    assert.equal(response.body.data[0].status, null);
    assert.equal(response.body.data[0].lastSeenAt, null);
  });
});

describe('GET /companies/:id/staff', () => {
  const deps = (capture = {}) => ({
    ...CROSSWALK_DEPS,
    query: sqlRows,
    Company: {
      ...CROSSWALK_DEPS.Company,
      findOne: () => selectLean({
        employees: [
          { user: 'u1', firstName: 'Ann', lastName: 'Lee', email: 'a@x.test', roleType: 'admin', status: 'Active' },
          { user: 'u2', firstName: 'Bob', email: 'b@x.test', roleType: 'category_manager', status: 'Pending' },
        ],
      }),
    },
    AdminUser: {
      find: () => selectLean([{ _id: 'acc1', email: 'a@x.test', mfaEnabled: true, lastLoginAt: new Date('2026-11-20T00:00:00.000Z') }]),
    },
    StaffActivityLog: { aggregate: async (p) => { capture.agg = p; return [{ _id: 'acc1', n: 9 }]; } },
  });

  test('cruza el empleado con su cuenta por correo', async () => {
    const response = makeResponse();
    await platformCompanyStaff(deps())({ params: { id: 'mongoA' }, query: {} }, response);
    const [ann, bob] = response.body.data;
    assert.equal(ann.twoStepEnabled, true);
    assert.equal(ann.actions30d, 9);
    // Bob no tiene cuenta: no se afirma nada sobre el.
    assert.equal(bob.twoStepEnabled, null);
    assert.equal(bob.actions30d, null);
    assert.equal(bob.scope, 'category');
  });

  test('el total es el equipo entero, no la pagina', async () => {
    const response = makeResponse();
    await platformCompanyStaff(deps())({ params: { id: 'mongoA' }, query: {} }, response);
    assert.equal(response.body.total, 2);
  });
});

describe('GET /companies/:id/subscription', () => {
  const deps = {
    ...CROSSWALK_DEPS,
    query: sqlRows,
    Company: { ...CROSSWALK_DEPS.Company, findOne: () => selectLean({ employees: [{ status: 'Active' }, { status: 'Pending' }] }) },
    CompanySubscription: {
      ...CROSSWALK_DEPS.CompanySubscription,
      findOne: () => lean({ _id: '675a1f3c0000000000000000', plan: 'free', status: 'active', current_period_end: null }),
    },
  };

  test('registro con el plan y los asientos usados', async () => {
    const response = makeResponse();
    await platformCompanySubscription(deps)({ params: { id: 'mongoA' }, query: {} }, response);
    assert.equal(response.body.data.plan, 'free');
    assert.equal(response.body.data.seatsUsed, 1, 'solo los activos');
    assert.ok(response.body.data.startedAt, 'la fecha sale del ObjectId');
  });

  test('un cliente sin documento de suscripcion no es un error', async () => {
    const response = makeResponse();
    await platformCompanySubscription({ ...deps, CompanySubscription: { ...deps.CompanySubscription, findOne: () => lean(null) } })(
      { params: { id: 'mongoA' }, query: {} }, response
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.plan, 'free');
  });
});

describe('GET /companies/:id/merchant', () => {
  // 501 y no 200-con-todo-null: lo segundo diria que el cliente no cobra.
  test('contesta 501 y explica que el dato vive en Stripe', async () => {
    const response = makeResponse();
    await platformCompanyMerchant()({ params: { id: 'mongoA' }, query: {} }, response);
    assert.equal(response.statusCode, 501);
    assert.equal(response.body.ok, false);
    assert.ok(Array.isArray(response.body.needs) && response.body.needs.length);
  });
});

describe('GET /attention', () => {
  const deps = (extra = {}) => ({
    Company: {
      find: () => selectLean([
        { _id: 'mongoA', company_name: 'Acme', employees: [{ active: true }] },
        { _id: 'mongoB', company_name: 'Beta' },
      ]),
    },
    CompanySubscription: {
      find: () => selectLean([
        { company: 'mongoA', sql_company_id: 7, status: 'past_due' },
        { company: 'mongoB', status: 'active' },
      ]),
    },
    StaffActivityLog: { aggregate: async () => [], distinct: async () => ['mongoA'] },
    query: async (sql) => {
      if (/FROM company_info/.test(sql)) return [[{ company_id: 7, company_name: 'Acme' }]];
      return [[]];
    },
    ...extra,
  });

  test('lista al cliente con la suscripcion en past_due', async () => {
    const response = makeResponse();
    await platformAttention(deps())({ query: {} }, response);
    const subs = response.body.data.filter((r) => r.kind === 'subscription');
    assert.equal(subs.length, 1);
    assert.equal(subs[0].companyId, 'mongoA');
    assert.match(subs[0].reason, /past_due/);
  });

  // Lo que distingue esta pantalla de una que miente: decir que no mide.
  test('declara que los equipos vencidos NO se estan midiendo', async () => {
    const response = makeResponse();
    await platformAttention(deps())({ query: {} }, response);
    assert.equal(response.body.conditions.devicesOverdue.active, false);
    assert.ok(response.body.conditions.devicesOverdue.reason);
    assert.equal(response.body.conditions.subscription.active, true);
  });

  // `lastLoginAt` empezo el 2026-11-09: antes del 12-09 nadie acumula 30 dias.
  test('la condicion de staff dormido esta apagada antes del 2026-12-09', async () => {
    const response = makeResponse();
    await platformAttention(deps({ now: '2026-11-26T00:00:00.000Z' }))({ query: {} }, response);
    assert.equal(response.body.conditions.staffDormant.active, false);
    assert.equal(response.body.data.some((r) => r.kind === 'staff_dormant'), false);
  });

  test('y se enciende sola a partir de esa fecha', async () => {
    const response = makeResponse();
    await platformAttention(deps({ now: '2026-12-10T00:00:00.000Z' }))({ query: {} }, response);
    assert.equal(response.body.conditions.staffDormant.active, true);
    // mongoA tuvo actividad; mongoB no.
    const dormant = response.body.data.filter((r) => r.kind === 'staff_dormant');
    assert.equal(dormant.length, 1);
    assert.equal(dormant[0].companyId, 'mongoB');
  });
});

// ────────────────────────────────── el esquema y las rutas como juez ────

describe('lo que se consulta existe de verdad', () => {
  test('User declara company_providers y event_providers', () => {
    const paths = Object.keys(UserModel.schema.paths);
    assert.ok(paths.includes('company_providers'));
    assert.ok(paths.includes('event_providers'));
  });

  test('AdminUser declara mfaEnabled y lastLoginAt', () => {
    const paths = Object.keys(AdminUserModel.schema.paths);
    assert.ok(paths.includes('mfaEnabled'));
    assert.ok(paths.includes('lastLoginAt'));
  });

  test('StaffActivityLog declara source y timestamp, y NO createdAt', () => {
    const paths = Object.keys(StaffActivityLogModel.schema.paths);
    assert.ok(paths.includes('source'));
    assert.ok(paths.includes('timestamp'));
    assert.ok(!paths.includes('createdAt'));
  });

  // Las nueve del console tienen que estar registradas. Una que falte da 404
  // y el console no puede distinguirla de una pestaña vacia.
  test('las nueve pestañas estan registradas, cada una por su nombre', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'platform.js'), 'utf8');
    const nine = ['activity', 'transactions', 'events', 'inventory', 'members',
      'consumers', 'staff', 'subscription', 'merchant'];
    for (const resource of nine) {
      assert.ok(
        source.includes(`"/companies/:id/${resource}"`),
        `falta la ruta /companies/:id/${resource}`
      );
    }
    // Y ningun comodin, que haria indistinguible "no existe" de "vacia".
    // Solo las lineas vivas: el comentario de arriba NOMBRA el comodin para
    // explicar por que no se usa, y un centinela que lee comentarios acabaria
    // prohibiendo que se documente la decision.
    const live = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    assert.doesNotMatch(live, /\/companies\/:id\/:[a-z]/i);
  });

  test('ninguna consulta a Event de las pestañas se deja el tipo', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'controller', 'platform.js'), 'utf8');
    const calls = source.match(/d\.Event\.(countDocuments|find)\(([^;]*?)\)/gs) || [];
    for (const call of calls) {
      assert.match(call, /EVENT_TYPE|filter\)|\.\.\.filter/, `consulta a Event sin tipo: ${call.slice(0, 80)}`);
    }
  });
});
