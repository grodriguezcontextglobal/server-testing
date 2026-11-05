'use strict';

/**
 * Lote 5 (2026-11-04).
 *
 *   - receivers-pool-bulk: sin duplicados por evento + compañía + dispositivo,
 *     ni dentro de la petición ni contra lo que ya hay (AC-3 / integridad).
 *   - receivers-pool y receivers-pool-bulk: la compañía del body tiene que ser
 *     una de quien llama (requireBodyCompanyMembership).
 *   - authorizePermission: company_id del body distinto de s-company-lq →
 *     warn lo registra y sigue; enforce 403 (COMPANY_CONTEXT_MODE).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';

// ── stubs del modelo del pool (antes de cargar el worker) ───────────────────
const pool = [];
const stubModel = (rel, exports) => {
  const filename = path.resolve(__dirname, '..', rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stubModel('models/ReceiversPool.js', {
  find: (filter) => ({
    lean: async () => pool.filter((d) =>
      d.eventSelected === filter.eventSelected && d.company === filter.company && filter.device.$in.includes(d.device)),
  }),
  insertMany: async (docs) => { pool.push(...docs); return docs; },
});
const warnings = [];
stubModel('helpers/logger.js', { warn: (msg, detail) => warnings.push({ msg, detail }), error() {}, info() {} });

const { poolReceiversBulk } = require('../controller/receiverWorker');
const { requireBodyCompanyMembership } = require('../middlewares/requireBodyCompanyMembership');
const { effectiveChain } = require('./helpers/effectiveChain');

const base = { eventSelected: 'Expo', company: COMPANY, type: 'Radio', provider: 'Acme' };

test('pool bulk: sin duplicados dentro de la petición ni contra lo que ya hay', async () => {
  pool.length = 0;
  const first = await poolReceiversBulk({ ...base, deviceList: ['A1', 'A2', 'A1', { device: 'A3' }] });
  assert.deepEqual(first.inserted.map((d) => d.device), ['A1', 'A2', 'A3']);
  assert.equal(first.skippedDuplicates, 1);

  const second = await poolReceiversBulk({ ...base, deviceList: JSON.stringify(['A2', 'A3', 'A4']) });
  assert.deepEqual(second.inserted.map((d) => d.device), ['A4']);
  assert.equal(second.skippedDuplicates, 2);
  assert.equal(pool.length, 4);
});

test('pool bulk: el mismo serial en otro evento u otra compañía sí entra', async () => {
  pool.length = 0;
  await poolReceiversBulk({ ...base, deviceList: ['A1'] });
  const otherEvent = await poolReceiversBulk({ ...base, eventSelected: 'Fair', deviceList: ['A1'] });
  const otherCompany = await poolReceiversBulk({ ...base, company: OTHER, deviceList: ['A1'] });
  assert.equal(otherEvent.inserted.length, 1);
  assert.equal(otherCompany.inserted.length, 1);
});

test('pool bulk: todo repetido no escribe y devuelve inserted vacío', async () => {
  pool.length = 0;
  await poolReceiversBulk({ ...base, deviceList: ['A1'] });
  const again = await poolReceiversBulk({ ...base, deviceList: ['A1'] });
  assert.deepEqual(again, { inserted: [], skippedDuplicates: 1 });
  assert.equal(pool.length, 1);
});

// ── requireBodyCompanyMembership ────────────────────────────────────────────

function membershipMw({ superUser = false, members = { [COMPANY]: ['u1'] } } = {}) {
  return requireBodyCompanyMembership('company', {
    AdminUser: () => ({
      findById: (id) => ({ select: () => ({ lean: async () => (id ? { email: `${id}@x.com`, super_user: superUser } : null) }) }),
    }),
    findCompanyMembership: async (companyId, user) => (members[companyId]?.includes(user.id) ? { active: true } : null),
  });
}
async function run(mw, req) {
  let passed = false;
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await mw({ headers: {}, ...req }, res, () => { passed = true; });
  return { passed, code: res.code };
}

test('membresía: empleado activo de la compañía del body pasa', async () => {
  assert.deepEqual(await run(membershipMw(), { uid: 'u1', body: { company: COMPANY } }), { passed: true, code: 200 });
});

test('membresía: compañía ajena 403, sin compañía 400, header distinto 403', async () => {
  assert.equal((await run(membershipMw(), { uid: 'u1', body: { company: OTHER } })).code, 403);
  assert.equal((await run(membershipMw(), { uid: 'u1', body: {} })).code, 400);
  assert.equal((await run(membershipMw(), { uid: 'u1', body: { company: { $ne: null } } })).code, 400);
  assert.equal((await run(membershipMw(), { uid: 'u1', body: { company: COMPANY }, headers: { 'x-company-id': OTHER } })).code, 403);
});

test('membresía: super_user de plataforma pasa', async () => {
  assert.equal((await run(membershipMw({ superUser: true }), { uid: 'root', body: { company: OTHER } })).passed, true);
});

test('las dos rutas del pool llevan la comprobación de membresía', () => {
  const router = require('../routes/receivers');
  for (const p of ['/receivers-pool', '/receivers-pool-bulk']) {
    const chain = effectiveChain(router, 'POST', p);
    assert.ok(chain.some((fn) => fn.name === 'requireBodyCompanyMembershipMw'), p);
  }
});

// ── authorizePermission + COMPANY_CONTEXT_MODE ──────────────────────────────

function loadAuthz() {
  const connPath = path.resolve(__dirname, '../mysql/database/config.js');
  const mwPath = path.resolve(__dirname, '../middlewares/authorizePermission.js');
  delete require.cache[connPath];
  delete require.cache[mwPath];
  const asked = [];
  require.cache[connPath] = {
    id: connPath, filename: connPath, loaded: true,
    exports: () => ({ query: async (_sql, params) => { asked.push(params[0]); return [[{ 1: 1 }]]; } }),
  };
  return { ...require('../middlewares/authorizePermission'), asked };
}
const sqlReq = (body, header) => ({
  method: 'POST', originalUrl: '/api/db_item/x', headers: {}, ip: '1.2.3.4',
  params: {}, query: {}, body, sqlStaffId: 7,
  header: (n) => (n === 's-company-lq' ? header : undefined),
});

test('company context warn: body y header distintos se registra y sigue con el body', async () => {
  delete process.env.COMPANY_CONTEXT_MODE;
  warnings.length = 0;
  const { authorizePermission, asked } = loadAuthz();
  const r = await run(authorizePermission('inventory', 'update'), sqlReq({ company_id: 5 }, '9'));
  assert.equal(r.passed, true);
  assert.deepEqual(asked, [5]);
  assert.match(warnings[0].msg, /^company context: body and header disagree \(COMPANY_CONTEXT_MODE=warn/);
  assert.deepEqual([warnings[0].detail.explicit, warnings[0].detail.header], ['5', '9']);
});

test('company context enforce: distintos 403 sin consultar; iguales pasan', async () => {
  process.env.COMPANY_CONTEXT_MODE = 'enforce';
  try {
    const { authorizePermission, asked } = loadAuthz();
    const bad = await run(authorizePermission('inventory', 'update'), sqlReq({ company_id: 5 }, '9'));
    assert.deepEqual(bad, { passed: false, code: 403 });
    assert.equal(asked.length, 0);
    const ok = await run(authorizePermission('inventory', 'update'), sqlReq({ company_id: 5 }, '5'));
    assert.equal(ok.passed, true);
    const onlyHeader = await run(authorizePermission('inventory', 'update'), sqlReq({}, '9'));
    assert.equal(onlyHeader.passed, true);
  } finally {
    delete process.env.COMPANY_CONTEXT_MODE;
  }
});

test('summarize-warn-logs reconoce el modo nuevo', () => {
  const src = require('node:fs').readFileSync(path.resolve(__dirname, '../scripts/summarize-warn-logs.js'), 'utf8');
  assert.match(src, /mode: 'COMPANY_CONTEXT_MODE'/);
});
