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
