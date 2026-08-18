/**
 * POST /api/db_staff/new_member — alta idempotente por email
 *
 * `staff_member.email` tiene UNIQUE (`uq_staff_member_email`) desde el
 * 2026-08-18, junto con la limpieza de duplicados
 * (mysql/migrations/dedupe_staff_member_by_email.sql). El INSERT plano que
 * tenía este endpoint ahora devolvería 1062; antes del índice devolvía una
 * fila duplicada más — un email llegó a tener 9 y la resolución de `staff_id`
 * quedaba ambigua, al punto de que un login con rol scopeado resolvió al rol
 * equivocado.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// ─── Stub de la conexión SQL ─────────────────────────────────────────────────
// El controller hace `const connection = getConnection()` a nivel de módulo, así
// que el stub tiene que estar en require.cache ANTES de importarlo.
const sqlLog = [];
const sqlBehavior = { existingStaffId: null, insertError: null };

const sqlConnPath = require.resolve('../mysql/database/config');
require.cache[sqlConnPath] = {
  id: sqlConnPath,
  filename: sqlConnPath,
  loaded: true,
  exports: () => ({
    execute: async (sql, params) => {
      sqlLog.push({ sql, params });

      if (sql.includes('SELECT staff_id FROM staff_member')) {
        return sqlBehavior.existingStaffId === null
          ? [[]]
          : [[{ staff_id: sqlBehavior.existingStaffId }]];
      }

      if (sql.includes('INSERT INTO staff_member')) {
        if (sqlBehavior.insertError) throw sqlBehavior.insertError;
        return [{ insertId: 500, affectedRows: 1 }];
      }

      return [[]];
    },
    query: async () => [[]],
  }),
};

const { insertingStaffMember } = require('../mysql/controllers/staff');

function mockRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function reset() {
  sqlLog.length = 0;
  sqlBehavior.existingStaffId = null;
  sqlBehavior.insertError = null;
}

const body = {
  first_name: 'Ana',
  last_name: 'López',
  email: 'ana@test.com',
  phone_number: '555',
};

test('insertingStaffMember: 201 e inserta cuando el email no existe', async () => {
  reset();
  const res = mockRes();

  await insertingStaffMember({ body }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.created, true);
  assert.equal(res.body.staff_id, 500);
  assert.ok(sqlLog.some(q => q.sql.includes('INSERT INTO staff_member')));
});

test('insertingStaffMember: 200 y reutiliza cuando el email ya existe, sin insertar', async () => {
  reset();
  sqlBehavior.existingStaffId = 177;
  const res = mockRes();

  await insertingStaffMember({ body }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.created, false);
  assert.equal(res.body.staff_id, 177);
  assert.equal(
    sqlLog.find(q => q.sql.includes('INSERT INTO staff_member')),
    undefined,
    'no debe intentar insertar una fila duplicada'
  );
});

// Dos requests con el mismo email pasan ambos el SELECT y solo uno gana el
// INSERT. El que pierde debe quedarse con la fila del ganador, no devolver 500.
test('insertingStaffMember: resuelve la carrera perdida contra el UNIQUE (1062)', async () => {
  reset();
  let selectCalls = 0;

  const sqlConnPathLocal = require.resolve('../mysql/database/config');
  const original = require.cache[sqlConnPathLocal].exports;
  require.cache[sqlConnPathLocal].exports = () => ({
    execute: async (sql, params) => {
      sqlLog.push({ sql, params });
      if (sql.includes('SELECT staff_id FROM staff_member')) {
        selectCalls += 1;
        // Primer SELECT: no existe. Segundo (tras el 1062): ya la creó el otro.
        return selectCalls === 1 ? [[]] : [[{ staff_id: 900 }]];
      }
      if (sql.includes('INSERT INTO staff_member')) {
        const err = new Error("Duplicate entry 'ana@test.com' for key 'uq_staff_member_email'");
        err.errno = 1062;
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      return [[]];
    },
    query: async () => [[]],
  });

  // Recargar el controller para que tome la conexión de esta carrera.
  const controllerPath = require.resolve('../mysql/controllers/staff');
  delete require.cache[controllerPath];
  const { insertingStaffMember: racing } = require(controllerPath);

  const res = mockRes();
  await racing({ body }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.created, false);
  assert.equal(res.body.staff_id, 900, 'se queda con la fila que ganó la carrera');
  assert.equal(selectCalls, 2, 'debe releer después del 1062');

  require.cache[sqlConnPathLocal].exports = original;
  delete require.cache[controllerPath];
});

// Un error que no sea el UNIQUE no debe disfrazarse de éxito.
test('insertingStaffMember: 500 si el INSERT falla por otra causa', async () => {
  reset();
  sqlBehavior.insertError = Object.assign(new Error('connection lost'), { errno: 2013 });
  const res = mockRes();

  await insertingStaffMember({ body }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
});
