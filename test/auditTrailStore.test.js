'use strict';

/**
 * Lado de almacenamiento y lectura del audit trail del servidor:
 *   - el worker traduce el id SQL de la compañía (s-company-lq) a su ObjectId;
 *   - GET /api/admin/activity-logs filtra por evento, dispositivo y member.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStaffActivityLogHandler } = require('../queue/handlers/staffActivityLog');
const { createGetStaffActivityLogs } = require('../controller/staffActivityLog');

const CO = 'aaaaaaaaaaaaaaaaaaaaaaaa';

test('worker: guarda el desglose (display) con la compañía por su nombre', async () => {
  let saved;
  const handler = createStaffActivityLogHandler(async (doc) => { saved = doc; return { id: 'L1' }; }, {
    findActor: async () => ({ name: 'Ana', email: 'ana@x.com' }),
    findCompanyName: async (id) => (id === CO ? 'Acme' : undefined),
  });
  await handler({
    source: 'server',
    staff_member_id: 'u1',
    company_id: CO,
    action: 'CHECK_OUT',
    target_model: 'Inventory',
    details: { route: 'POST /api/db_item/item-out-warehouse', request: { serials: ['A1', 'A2'], event_id: 7 } },
    context: { serial_numbers: ['A1', 'A2'], event_id: '7' },
  });
  assert.equal(saved.display.who.name, 'Ana');
  assert.equal(saved.display.what.verb, 'Checked out');
  assert.equal(saved.display.what.object, '2 items (A1, A2) from the warehouse');
  assert.deepEqual(saved.display.where, { event: '#7', company: 'Acme' });
  assert.ok(saved.display.when);
});

test('worker: el log de acceso a datos de alumnos manda el id SQL en company_id; se traduce', async () => {
  let saved;
  const handler = createStaffActivityLogHandler(async (doc) => { saved = doc; return { id: 'L1' }; }, {
    findCompanyNameBySqlId: async (id) => (id === '137' ? 'Acme' : null),
    findCompaniesByName: async (name) => (name === 'Acme' ? [{ _id: CO }] : []),
  });
  await handler({
    staff_member_id: 'u1', company_id: '137', action: 'READ', target_model: 'SchoolPII',
    details: { route: '/api/school/roster', status: 200 },
  });
  assert.equal(saved.company_id, CO);
  assert.equal(saved.company_sql_id, '137');
  assert.equal(saved.summary, 'Viewed student records (roster)');
});

test('worker: la devolución desde el consumidor del evento queda como una frase completa', async () => {
  // El request real de producción solo trae { id, device }; consumidor y
  // evento salen del documento Receivers.
  let saved;
  const handler = createStaffActivityLogHandler(async (doc) => { saved = doc; return { id: 'L1' }; }, {
    findActor: async () => ({ name: 'Gustavo', lastName: 'Santeliz', email: 'g@x.com' }),
    findReceiver: async (id) => (id === 'R1'
      ? { user: 'ana@x.com', eventSelected: ['TEST _ 2'], event_id: 55, device: { serialNumber: 'SN-100006' } }
      : null),
  });
  await handler({
    source: 'server',
    staff_member_id: 'u1',
    company_id: CO,
    action: 'UPDATE',
    target_model: 'Device',
    target_id: 'R1',
    details: {
      route: 'PATCH /api/receiver/receiver-update/:id',
      request: { id: 'R1', device: { serialNumber: 'SN-100006', status: false } },
    },
    context: { serial_numbers: ['SN-100006'] },
  });
  assert.equal(saved.action, 'RETURN');
  assert.equal(saved.summary, 'Returned device SN-100006 from ana@x.com at event TEST _ 2');
  assert.equal(saved.target_label, 'SN-100006');
  assert.deepEqual(saved.actor, { name: 'Gustavo Santeliz', email: 'g@x.com' });
  assert.equal(saved.context.event_id, '55');
});

test('worker: la vuelta al pool lee evento y serial del documento del pool', async () => {
  let saved;
  const handler = createStaffActivityLogHandler(async (doc) => { saved = doc; return { id: 'L1' }; }, {
    findPoolEntry: async () => ({ eventSelected: 'TEST _ 2', device: 'SN-100006' }),
  });
  await handler({
    source: 'server',
    company_id: CO,
    action: 'UPDATE',
    target_model: 'Device',
    target_id: 'P1',
    details: { route: 'PATCH /api/receiver/receivers-pool-update/:id', request: { id: 'P1', activity: false } },
  });
  assert.equal(saved.summary, 'Marked device SN-100006 as available in the pool at event TEST _ 2');
});

test('worker: si la consulta de enriquecimiento falla, el registro se guarda igual', async () => {
  let saved;
  const handler = createStaffActivityLogHandler(async (doc) => { saved = doc; return { id: 'L1' }; }, {
    findReceiver: async () => { throw new Error('mongo down'); },
    findActor: async () => { throw new Error('mongo down'); },
  });
  await handler({
    company_id: CO,
    action: 'UPDATE',
    target_model: 'Device',
    target_id: 'R1',
    details: { route: 'PATCH /api/receiver/receiver-update/:id', request: { device: { status: false } } },
  });
  assert.equal(saved.action, 'RETURN');
  assert.match(saved.summary, /^Returned device/);
  assert.equal(saved.actor, undefined);
});

test('worker: los registros de los controladores (login) también reciben frase y autor', async () => {
  let saved;
  const handler = createStaffActivityLogHandler(async (doc) => { saved = doc; return { id: 'L1' }; }, {
    findActor: async () => ({ name: 'Ana', email: 'ana@x.com' }),
  });
  await handler({ staff_member_id: 'u1', action: 'LOGIN', target_model: 'AdminUser', target_id: 'u1' });
  assert.equal(saved.summary, 'Logged in');
  assert.deepEqual(saved.actor, { name: 'Ana', email: 'ana@x.com' });
});

test('worker: company_sql_id se traduce a company_id por el nombre de la compañía', async () => {
  let saved;
  const handler = createStaffActivityLogHandler(async (doc) => { saved = doc; return { id: 'L1' }; }, {
    findCompanyNameBySqlId: async (id) => (id === '137' ? 'Acme' : null),
    findCompaniesByName: async (name) => (name === 'Acme' ? [{ _id: CO }] : []),
  });
  await handler({ action: 'CREATE', target_model: 'Inventory', company_id: null, company_sql_id: '137' });
  assert.equal(saved.company_id, CO);
  assert.equal(saved.company_sql_id, '137');
});

test('worker: si la traducción no resuelve, se guarda sin compañía pero con el id SQL', async () => {
  let saved;
  const handler = createStaffActivityLogHandler(async (doc) => { saved = doc; return { id: 'L1' }; }, {
    findCompanyNameBySqlId: async () => { throw new Error('mysql down'); },
    findCompaniesByName: async () => [],
  });
  await handler({ action: 'CREATE', target_model: 'Inventory', company_id: null, company_sql_id: '999' });
  assert.equal(saved.company_id, null);
  assert.equal(saved.company_sql_id, '999');
});

test('worker: un company_id ya válido no pasa por la traducción SQL', async () => {
  let asked = false;
  let saved;
  const handler = createStaffActivityLogHandler(async (doc) => { saved = doc; return { id: 'L1' }; }, {
    findCompanyNameBySqlId: async () => { asked = true; return 'X'; },
    findCompaniesByName: async () => [],
  });
  await handler({ company_id: CO, company_sql_id: '137' });
  assert.equal(saved.company_id, CO);
  assert.equal(asked, false);
});

test('worker: sin cabecera de compañía, se infiere si el autor está en UNA sola compañía', async () => {
  let saved;
  const handler = createStaffActivityLogHandler(async (doc) => { saved = doc; return { id: 'L1' }; }, {
    findActorCompanyIds: async () => [CO],
  });
  await handler({ source: 'server', staff_member_id: 'u1', company_id: null, details: { route: 'r' } });
  assert.equal(saved.company_id, CO);
  assert.equal(saved.details.company_inferred, true);
  assert.equal(saved.details.route, 'r');
});

test('worker: con varias compañías no se adivina', async () => {
  let saved;
  const handler = createStaffActivityLogHandler(async (doc) => { saved = doc; return { id: 'L1' }; }, {
    findActorCompanyIds: async () => [CO, 'bbbbbbbbbbbbbbbbbbbbbbbb'],
  });
  await handler({ source: 'server', staff_member_id: 'u1', company_id: null });
  assert.equal(saved.company_id, null);
});

function fakeModel() {
  const seen = {};
  const chain = { sort: () => chain, skip: () => chain, limit: () => chain, populate: async () => [] };
  return {
    seen,
    find: (q) => { seen.query = q; return chain; },
    countDocuments: async () => 0,
  };
}

test('GET activity-logs: un usuario normal ve lo de su compañía Y lo propio sin compañía', async () => {
  const model = fakeModel();
  const handler = createGetStaffActivityLogs({
    findAdminUserFn: async () => ({ id: 'u1', email: 'u1@x.com', super_user: false }),
    findMembershipsFn: async () => [{ _id: CO, company_name: 'Acme' }],
    StaffActivityLogModel: model,
  });
  const res = { json: () => {}, status: () => res };
  await handler({
    uid: 'u1',
    headers: { 'x-company-id': CO },
    header: (n) => (n === 'x-company-id' ? CO : undefined),
    query: {},
  }, res);
  const q = model.seen.query;
  assert.equal(q.company_id, undefined, 'el scope de compañía va dentro del $or');
  assert.deepEqual(q.$or, [
    { company_id: { $in: [CO, 'Acme'] } },
    { company_id: null, staff_member_id: 'u1' },
  ]);
});

test('GET activity-logs: filtrar por otro staff no expone lo propio sin compañía', async () => {
  const model = fakeModel();
  const handler = createGetStaffActivityLogs({
    findAdminUserFn: async () => ({ id: 'u1', super_user: false }),
    findMembershipsFn: async () => [{ _id: CO, company_name: 'Acme' }],
    StaffActivityLogModel: model,
  });
  const res = { json: () => {}, status: () => res };
  await handler({
    uid: 'u1', headers: {}, header: () => undefined, query: { staff_member_id: 'u2' },
  }, res);
  // staff_member_id = u2 Y ($or: compañía | (null y u1)) → la rama de null exige
  // u1 y u2 a la vez, así que solo quedan los registros de u2 en la compañía.
  assert.equal(model.seen.query.staff_member_id, 'u2');
  assert.ok(Array.isArray(model.seen.query.$or));
});

test('GET activity-logs: filtros por evento, serial, item, member, consumidor y origen', async () => {
  const model = fakeModel();
  const handler = createGetStaffActivityLogs({
    findAdminUserFn: async () => ({ id: 'u', super_user: true }),
    StaffActivityLogModel: model,
  });
  const res = { json: () => {}, status: () => res };
  await handler({
    uid: 'u',
    headers: {},
    header: () => undefined,
    query: {
      event_id: '701', serial_number: 'SN-1', item_id: '4567', member_id: '9',
      consumer: 'ana@x.com', source: 'server', actor_type: 'staff', target_id: '88',
    },
  }, res);
  assert.equal(model.seen.query['context.event_id'], '701');
  assert.equal(model.seen.query['context.serial_numbers'], 'SN-1');
  assert.equal(model.seen.query['context.item_ids'], '4567');
  assert.equal(model.seen.query['context.member_id'], '9');
  assert.equal(model.seen.query['context.consumer'], 'ana@x.com');
  assert.equal(model.seen.query.source, 'server');
  assert.equal(model.seen.query.actor_type, 'staff');
  assert.equal(model.seen.query.target_id, '88');
});
