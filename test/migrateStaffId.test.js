'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Importamos solo la función de resolución pura — sin conexiones DB
const { resolveStaffIdUpdates } = require('../mysql/scripts/migrate-staff-id');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Regex de un MongoDB ObjectId (24 hex)
const MONGO_ID_RE = /^[0-9a-f]{24}$/i;

// ─── Tests ────────────────────────────────────────────────────────────────────

test('resolveStaffIdUpdates: convierte MongoDB ObjectId → staff_member.id INT', () => {
  const rows = [
    { id: 'cs-1', staff_id: '661d7f57b5dd5c170d866933' },
    { id: 'cs-2', staff_id: 'aabbccdd11223344aabbcc01' },
  ];
  const mongoIdToEmail = new Map([
    ['661d7f57b5dd5c170d866933', 'grodriguez@contextglobal.com'],
    ['aabbccdd11223344aabbcc01', 'other@example.com'],
  ]);
  const emailToSqlId = new Map([
    ['grodriguez@contextglobal.com', 74],
    ['other@example.com',            99],
  ]);

  const updates = resolveStaffIdUpdates(rows, mongoIdToEmail, emailToSqlId);

  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0], { id: 'cs-1', newStaffId: 74 });
  assert.deepEqual(updates[1], { id: 'cs-2', newStaffId: 99 });
});

test('resolveStaffIdUpdates: omite filas cuyo staff_id ya es un entero (migración parcial)', () => {
  const rows = [
    { id: 'cs-already', staff_id: '74' },  // ya fue migrado
    { id: 'cs-mongo',   staff_id: '661d7f57b5dd5c170d866933' },
  ];
  const mongoIdToEmail = new Map([
    ['661d7f57b5dd5c170d866933', 'grodriguez@contextglobal.com'],
  ]);
  const emailToSqlId = new Map([
    ['grodriguez@contextglobal.com', 74],
  ]);

  const updates = resolveStaffIdUpdates(rows, mongoIdToEmail, emailToSqlId);

  // Solo la fila con MongoDB ObjectId debe producir un UPDATE
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 'cs-mongo');
  assert.equal(updates[0].newStaffId, 74);
});

test('resolveStaffIdUpdates: reporta filas sin mapeo (email no está en staff_member)', () => {
  const rows = [
    { id: 'cs-ghost', staff_id: 'deadbeefdeadbeefdeadbe01' },
  ];
  const mongoIdToEmail = new Map([
    ['deadbeefdeadbeefdeadbe01', 'ghost@example.com'],
  ]);
  const emailToSqlId = new Map(); // email no existe en SQL

  const updates = resolveStaffIdUpdates(rows, mongoIdToEmail, emailToSqlId);

  // Sin mapeo SQL → no se produce UPDATE, la fila queda en unmapped
  assert.equal(updates.length, 0);
});

test('resolveStaffIdUpdates: reporta filas cuyo MongoDB ObjectId no existe en AdminUser', () => {
  const rows = [
    { id: 'cs-orphan', staff_id: '111111111111111111111111' },
  ];
  const mongoIdToEmail = new Map(); // ID no encontrado en MongoDB
  const emailToSqlId   = new Map([['grodriguez@contextglobal.com', 74]]);

  const updates = resolveStaffIdUpdates(rows, mongoIdToEmail, emailToSqlId);

  assert.equal(updates.length, 0);
});

// ─── Caso real: email como staff_id ──────────────────────────────────────────

test('resolveStaffIdUpdates: convierte email directo → staff_member.staff_id INT', () => {
  const rows = [
    { id: 'cs-email-1', staff_id: 'grodriguez@contextglobal.com' },
    { id: 'cs-email-2', staff_id: 'other@example.com' },
  ];
  const mongoIdToEmail = new Map(); // vacío — no hay ObjectIds
  const emailToSqlId = new Map([
    ['grodriguez@contextglobal.com', 74],
    ['other@example.com',            99],
  ]);

  const updates = resolveStaffIdUpdates(rows, mongoIdToEmail, emailToSqlId);

  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0], { id: 'cs-email-1', newStaffId: 74 });
  assert.deepEqual(updates[1], { id: 'cs-email-2', newStaffId: 99 });
});

test('resolveStaffIdUpdates: email en staff_id sin match en staff_member → unmapped', () => {
  const rows = [
    { id: 'cs-no-sm', staff_id: 'unknown@nowhere.com' },
  ];
  const mongoIdToEmail = new Map();
  const emailToSqlId   = new Map([['grodriguez@contextglobal.com', 74]]);

  const updates = resolveStaffIdUpdates(rows, mongoIdToEmail, emailToSqlId);

  assert.equal(updates.length, 0);
  assert.equal(updates.unmapped.length, 1);
  assert.equal(updates.unmapped[0].staff_id, 'unknown@nowhere.com');
});

test('resolveStaffIdUpdates: mezcla de email e INT — INT se salta, email se convierte', () => {
  const rows = [
    { id: 'cs-int',   staff_id: '74' },                           // ya migrado
    { id: 'cs-email', staff_id: 'grodriguez@contextglobal.com' },
  ];
  const mongoIdToEmail = new Map();
  const emailToSqlId = new Map([['grodriguez@contextglobal.com', 74]]);

  const updates = resolveStaffIdUpdates(rows, mongoIdToEmail, emailToSqlId);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 'cs-email');
  assert.equal(updates[0].newStaffId, 74);
});

test('resolveStaffIdUpdates: retorna objeto con updates y unmapped para logging', () => {
  const rows = [
    { id: 'cs-ok',     staff_id: '661d7f57b5dd5c170d866933' },
    { id: 'cs-noemail', staff_id: 'ffffffffffffffffffffffff' },
  ];
  const mongoIdToEmail = new Map([
    ['661d7f57b5dd5c170d866933', 'grodriguez@contextglobal.com'],
    // 'ffffffffffffffffffffffff' no está en el map
  ]);
  const emailToSqlId = new Map([
    ['grodriguez@contextglobal.com', 74],
  ]);

  const result = resolveStaffIdUpdates(rows, mongoIdToEmail, emailToSqlId);

  // La función puede devolver array simple o { updates, unmapped } — verificamos ambas formas
  const updates   = Array.isArray(result) ? result : result.updates;
  const unmapped  = Array.isArray(result) ? null   : result.unmapped;

  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 'cs-ok');

  if (unmapped !== null) {
    assert.equal(unmapped.length, 1);
    assert.equal(unmapped[0].id, 'cs-noemail');
  }
});
