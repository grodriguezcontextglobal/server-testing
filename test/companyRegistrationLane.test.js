'use strict';

/**
 * /api/db_company (FedRAMP P1.1, 2026-10-21).
 *
 *   - consulting-company y new_company: con sesión, normal; sin sesión, en
 *     DB_COMPANY_PUBLIC_MODE=warn pasan (consulting-company solo por id o
 *     nombre) y en enforce dan 401.
 *   - consultingCompany y updateCompanyData: los nombres de columna salen de
 *     una lista blanca (antes, de las claves del body: inyección SQL).
 */

process.env.SECRET_JWT_SEED = process.env.SECRET_JWT_SEED || 'test-seed';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stub = (rel, exports) => {
  const filename = path.join(root, rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

let staffSession = false;
const queries = [];
stub('helpers/consumerUserFilter.js', { isStaffSession: async () => staffSession, isStaffOrigin: () => false });
stub('helpers/logger.js', { warn() {}, error() {}, info() {}, log() {} });
stub('mysql/database/config.js', () => ({
  execute: async (sql, values) => { queries.push({ sql, values }); return [{ affectedRows: 1 }]; },
}));

const router = require('../mysql/routes/company');
const { consultingCompany, updateCompanyData } = require('../mysql/controllers/company');

const laneOf = (routePath) =>
  router.stack.find((l) => l.route?.path === routePath).route.stack.at(-2).handle;

function res() {
  return { status(c) { this.code = c; return this; }, json(b) { this.body = b; if (!this.code) this.code = 200; return this; } };
}
async function runLane(routePath, body) {
  const req = { path: routePath, body, header: () => undefined, ip: '1.2.3.4' };
  const r = res();
  let passed = false;
  await laneOf(routePath)(req, r, () => { passed = true; });
  return { r, passed };
}

test.afterEach(() => { delete process.env.DB_COMPANY_PUBLIC_MODE; staffSession = false; queries.length = 0; });

test('industry es pública; consulting-company y new_company van por el carril de registro', () => {
  assert.deepEqual(
    [...router.PUBLIC_ROUTES].sort(),
    ['POST /consulting-company', 'POST /industry', 'POST /new_company'],
  );
});

test('sin sesión, en warn: consulting-company pasa con company_id o company_name', async () => {
  for (const body of [{ company_id: 148 }, { company_name: 'Bridges' }]) {
    const { passed } = await runLane('/consulting-company', body);
    assert.ok(passed, JSON.stringify(body));
  }
});

test('sin sesión: consulting-company con otro filtro, o vacío, da 400', async () => {
  for (const body of [{}, { email_company: 'a@x.com' }, { company_id: 1, industry: 'x' }]) {
    const { r, passed } = await runLane('/consulting-company', body);
    assert.equal(passed, false);
    assert.equal(r.code, 400);
  }
});

test('sin sesión, en enforce: 401 en las dos', async () => {
  process.env.DB_COMPANY_PUBLIC_MODE = 'enforce';
  for (const p of ['/consulting-company', '/new_company']) {
    const { r, passed } = await runLane(p, { company_id: 1 });
    assert.equal(passed, false);
    assert.equal(r.code, 401);
  }
});

test('con sesión de staff pasa siempre, también en enforce', async () => {
  process.env.DB_COMPANY_PUBLIC_MODE = 'enforce';
  staffSession = true;
  const { passed } = await runLane('/consulting-company', { industry: 'x' });
  assert.ok(passed);
});

test('consultingCompany: columna desconocida → 400 y no hay consulta', async () => {
  const r = res();
  await consultingCompany({ body: { 'company_id` = 1 OR 1=1 -- ': 'x' } }, r);
  assert.equal(r.code, 400);
  assert.equal(queries.length, 0);
});

test('consultingCompany: sin filtro → 400 (antes devolvía todas las compañías)', async () => {
  const r = res();
  await consultingCompany({ body: {} }, r);
  assert.equal(r.code, 400);
  assert.equal(queries.length, 0);
});

test('consultingCompany: filtro válido consulta con valor parametrizado', async () => {
  const r = res();
  await consultingCompany({ body: { company_name: 'Bridges' } }, r);
  assert.equal(r.code, 200);
  assert.match(queries[0].sql, /WHERE `company_name` = \?/);
  assert.deepEqual(queries[0].values, ['Bridges']);
});

test('updateCompanyData: solo columnas editables', async () => {
  const bad = res();
  await updateCompanyData({ body: { company_id: 1, 'industry=1, company_id': 2 } }, bad);
  assert.equal(bad.code, 400);
  const badCol = res();
  await updateCompanyData({ body: { company_id: 1, company_id_2: 5 } }, badCol);
  assert.equal(badCol.code, 400);
  assert.equal(queries.length, 0);

  const ok = res();
  await updateCompanyData({ body: { company_id: 1, company_name: 'New', phone_number: '1' } }, ok);
  assert.equal(ok.code, 200);
  assert.match(queries[0].sql, /SET `company_name` = \?, `phone_number` = \?/);
});
