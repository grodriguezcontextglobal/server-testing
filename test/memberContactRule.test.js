'use strict';

// Regla de contacto de members_info (mysql/helpers/memberContact.js):
//   adulto → email Y phone_number; menor sin alguno de los dos → parent_guardian_email.
// El schema no la impone, así que la cubren los tres caminos de escritura.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { memberContactProblem } = require('../mysql/helpers/memberContact');

// ─── helper ──────────────────────────────────────────────────────────────────

test('memberContactProblem: adulto con email y teléfono es válido', () => {
  assert.equal(memberContactProblem({ minor: 0, email: 'a@b.com', phone_number: '555' }), null);
});

test('memberContactProblem: adulto sin email o sin teléfono falla, y dice cuál falta', () => {
  assert.deepEqual(memberContactProblem({ minor: 0, phone_number: '555' }).missing, ['email']);
  assert.deepEqual(memberContactProblem({ minor: 0, email: 'a@b.com', phone_number: '  ' }).missing, ['phone_number']);
  assert.deepEqual(memberContactProblem({}).missing, ['email', 'phone_number']);
});

test('memberContactProblem: minor NULL cuenta como adulto', () => {
  assert.ok(memberContactProblem({ minor: null, email: 'a@b.com' }));
});

test('memberContactProblem: menor sin contacto propio pero con email del tutor es válido', () => {
  assert.equal(memberContactProblem({ minor: 1, parent_guardian_email: 'tutor@b.com' }), null);
  assert.equal(memberContactProblem({ minor: 'yes', email: 'kid@b.com', parent_guardian_email: 'tutor@b.com' }), null);
});

test('memberContactProblem: menor sin contacto propio y sin email del tutor falla', () => {
  assert.deepEqual(memberContactProblem({ minor: 1 }).missing, ['parent_guardian_email']);
  assert.deepEqual(memberContactProblem({ minor: true, email: 'kid@b.com', parent_guardian_email: '' }).missing, ['parent_guardian_email']);
});

test('memberContactProblem: menor con email y teléfono propios no necesita tutor', () => {
  assert.equal(memberContactProblem({ minor: 1, email: 'kid@b.com', phone_number: '555' }), null);
});

// ─── controllers ─────────────────────────────────────────────────────────────

const root = path.resolve(__dirname, '..');
const connPath = path.join(root, 'mysql/database/config.js');
const controllerPath = path.join(root, 'mysql/controllers/members.js');

function loadController(queryImpl) {
  delete require.cache[connPath];
  delete require.cache[controllerPath];
  const calls = [];
  require.cache[connPath] = {
    id: connPath,
    filename: connPath,
    loaded: true,
    exports: () => ({
      query: async (sql, params) => {
        calls.push({ sql, params });
        return queryImpl(sql, params);
      },
    }),
  };
  return { ...require(controllerPath), calls };
}

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

const writes = (calls) => calls.filter((c) => /^\s*(INSERT|UPDATE)/i.test(c.sql));

test('insertNewMember: 400 para un adulto sin teléfono, sin tocar la base', async () => {
  const { insertNewMember, calls } = loadController(async () => [{ insertId: 1 }]);
  const res = mockRes();
  await insertNewMember({ body: { first_name: 'A', last_name: 'B', email: 'a@b.com', company_id: 1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload.missing, ['phone_number']);
  assert.equal(writes(calls).length, 0);
});

test('insertNewMember: un menor sin email ni teléfono entra si trae el email del tutor', async () => {
  const { insertNewMember, calls } = loadController(async () => [{ insertId: 7 }]);
  const res = mockRes();
  await insertNewMember({
    body: { first_name: 'Kid', last_name: 'B', company_id: 1, minor: true, parent_guardian_email: 'tutor@b.com' },
  }, res);
  assert.equal(res.statusCode, 201);
  const cols = writes(calls)[0].sql.match(/\(([^)]*)\)/)[1].split(',').map((c) => c.trim());
  assert.ok(!cols.includes('email') && !cols.includes('phone_number'));
  assert.ok(cols.includes('parent_guardian_email'));
});

test('insertNewMember: 400 para un menor sin contacto propio ni email del tutor', async () => {
  const { insertNewMember } = loadController(async () => [{ insertId: 1 }]);
  const res = mockRes();
  await insertNewMember({ body: { first_name: 'Kid', last_name: 'B', company_id: 1, minor: 1 } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload.missing, ['parent_guardian_email']);
});

const SCHEMA = [
  'first_name', 'last_name', 'email', 'phone_number', 'company_id', 'minor', 'parent_guardian_email',
].map((Field) => ({ Field }));

test('insertBulkMembers: salta las filas que no cumplen, encola el resto y dice por qué', async () => {
  const { createInsertBulkMembers } = loadController(async () => [SCHEMA]);
  let payload;
  const controller = createInsertBulkMembers({
    enqueueFn: async (type, p) => { payload = p; return { id: 'J' }; },
    extractContextFn: () => ({}),
    waitForJobOutcomeFn: async () => ({ outcome: 'done', result: { affectedRows: 2 } }),
  });
  const res = mockRes();
  await controller({ body: { rows: [
    { first_name: 'Ad', last_name: 'Ok', email: 'a@b.com', phone_number: '555' },
    { first_name: 'Ad', last_name: 'NoPhone', email: 'a@b.com', phone_number: '' },
    { first_name: 'Kid', last_name: 'Ok', minor: 'yes', parent_guardian_email: 'tutor@b.com' },
    { first_name: 'Kid', last_name: 'NoTutor', minor: 'yes' },
    { email: 'sin-nombre@b.com' },
  ] } }, res);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(payload.valid.map((r) => r.last_name), ['Ok', 'Ok']);
  assert.equal(res.payload.skipped, 3);
  assert.deepEqual(res.payload.contact_skipped.map((s) => [s.row, s.missing]), [
    [1, ['phone_number']],
    [3, ['parent_guardian_email']],
  ]);
});

test('insertBulkMembers: 400 si ninguna fila cumple la regla (no encola)', async () => {
  const { createInsertBulkMembers } = loadController(async () => [SCHEMA]);
  let enqueued = 0;
  const controller = createInsertBulkMembers({ enqueueFn: async () => { enqueued++; return { id: 'J' }; } });
  const res = mockRes();
  await controller({ body: { rows: [{ first_name: 'A', last_name: 'B' }] } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(enqueued, 0);
  assert.equal(res.payload.contact_skipped.length, 1);
});

test('updateMemberInfo: 400 al vaciar el email de un adulto', async () => {
  const { updateMemberInfo, calls } = loadController(async (sql) =>
    /^\s*SELECT/i.test(sql)
      ? [[{ email: 'a@b.com', phone_number: '555', minor: 0, parent_guardian_email: null }]]
      : [{ affectedRows: 1 }]);
  const res = mockRes();
  await updateMemberInfo({ body: { member_id: 5, email: '' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload.missing, ['email']);
  assert.equal(writes(calls).length, 0);
});

test('updateMemberInfo: 400 al pasar a adulto un menor que no tiene contacto propio', async () => {
  const { updateMemberInfo } = loadController(async (sql) =>
    /^\s*SELECT/i.test(sql)
      ? [[{ email: null, phone_number: null, minor: 1, parent_guardian_email: 'tutor@b.com' }]]
      : [{ affectedRows: 1 }]);
  const res = mockRes();
  await updateMemberInfo({ body: { member_id: 5, minor: 0 } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload.missing, ['email', 'phone_number']);
});

test('updateMemberInfo: quitarle el teléfono a un menor con tutor sí se permite', async () => {
  const { updateMemberInfo, calls } = loadController(async (sql) =>
    /^\s*SELECT/i.test(sql)
      ? [[{ email: null, phone_number: '555', minor: 1, parent_guardian_email: 'tutor@b.com' }]]
      : [{ affectedRows: 1 }]);
  const res = mockRes();
  await updateMemberInfo({ body: { member_id: 5, phone_number: '' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(writes(calls).length, 1);
});

test('updateMemberInfo: un cambio que no toca contacto no lee la fila', async () => {
  const { updateMemberInfo, calls } = loadController(async () => [{ affectedRows: 1 }]);
  const res = mockRes();
  await updateMemberInfo({ body: { member_id: 5, grade: '7' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.filter((c) => /^\s*SELECT/i.test(c.sql)).length, 0);
});
