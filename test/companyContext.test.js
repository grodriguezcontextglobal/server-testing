'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveCompanyContext, COMPANY_HEADER } = require('../mysql/helpers/companyContext');

/** Minimal express-like request. */
const makeReq = ({ headers = {}, body, query, sqlStaffId } = {}) => ({
  headers,
  body,
  query,
  sqlStaffId,
  header(name) { return this.headers[name]; },
});

const allowAll = async () => ({ company_staff_id: 1, role_level: 0 });
const denyAll = async () => null;

test('lee el company id del header s-company-lq', async () => {
  const result = await resolveCompanyContext(
    makeReq({ headers: { [COMPANY_HEADER]: '133' }, sqlStaffId: 7 }),
    { getStaffCompanyAccessFn: allowAll }
  );
  assert.equal(result.ok, true);
  assert.equal(result.companyId, '133');
});

test('el header gana sobre el body (misma request, dos fuentes)', async () => {
  const result = await resolveCompanyContext(
    makeReq({ headers: { [COMPANY_HEADER]: '133' }, body: { company_id: '999' }, sqlStaffId: 7 }),
    { getStaffCompanyAccessFn: allowAll }
  );
  assert.equal(result.companyId, '133');
});

test('cae al body y al query para call sites que aun no migran', async () => {
  const desdeBody = await resolveCompanyContext(
    makeReq({ body: { company_id: '133' }, sqlStaffId: 7 }),
    { getStaffCompanyAccessFn: allowAll }
  );
  assert.equal(desdeBody.companyId, '133');

  const desdeQuery = await resolveCompanyContext(
    makeReq({ query: { company_id: '144' }, sqlStaffId: 7 }),
    { getStaffCompanyAccessFn: allowAll }
  );
  assert.equal(desdeQuery.companyId, '144');
});

// EL test que justifica que exista este helper: el header lo pone el cliente,
// igual que el body. Sin la verificacion contra company_staff seria exactamente
// la misma vulnerabilidad cross-tenant del endpoint viejo, en otro sobre.
test('un header apuntando a una compañía ajena da 403, no acceso', async () => {
  let consultado = null;
  const result = await resolveCompanyContext(
    makeReq({ headers: { [COMPANY_HEADER]: '999' }, sqlStaffId: 7 }),
    {
      getStaffCompanyAccessFn: async (staffId, companyId) => {
        consultado = { staffId, companyId };
        return null; // no es miembro activo de la 999
      },
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.deepEqual(consultado, { staffId: 7, companyId: '999' },
    'debe verificarse la compañía que pidió el cliente, contra la identidad del staff');
});

test('sin company id: 400', async () => {
  const result = await resolveCompanyContext(
    makeReq({ sqlStaffId: 7 }),
    { getStaffCompanyAccessFn: allowAll }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.msg, new RegExp(COMPANY_HEADER));
});

test('sin identidad de staff: 401, y no se consulta la BD', async () => {
  let llamado = false;
  const result = await resolveCompanyContext(
    makeReq({ headers: { [COMPANY_HEADER]: '133' } }),
    { getStaffCompanyAccessFn: async () => { llamado = true; return allowAll(); } }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(llamado, false, 'no debe pegarle a la BD sin identidad');
});

test('funciona con req.headers cuando no hay req.header() (fuera de express)', async () => {
  const req = { headers: { [COMPANY_HEADER]: '133' }, sqlStaffId: 7 };
  const result = await resolveCompanyContext(req, { getStaffCompanyAccessFn: allowAll });
  assert.equal(result.ok, true);
  assert.equal(result.companyId, '133');
});

test('devuelve el access resuelto, para que el caller no repita la consulta', async () => {
  const access = { company_staff_id: 42, role_level: 8, categories: [1, 2] };
  const result = await resolveCompanyContext(
    makeReq({ headers: { [COMPANY_HEADER]: '133' }, sqlStaffId: 7 }),
    { getStaffCompanyAccessFn: async () => access }
  );
  assert.equal(result.access, access);
});

test('deniega cuando el staff no pertenece a ninguna compañía', async () => {
  const result = await resolveCompanyContext(
    makeReq({ headers: { [COMPANY_HEADER]: '133' }, sqlStaffId: 7 }),
    { getStaffCompanyAccessFn: denyAll }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});
