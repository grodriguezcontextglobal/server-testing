'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const controllerPath = path.resolve(__dirname, '../mysql/controllers/school.js');
const dbPath = path.resolve(__dirname, '../mysql/database/config.js');
const loggerPath = path.resolve(__dirname, '../helpers/logger.js');
const { buildReminderJobs } = require(path.resolve(__dirname, '../scheduler/overdueReminders.js'));

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// Tabla en memoria que aplica el UPDATE de setLeaseReminders con sus mismos params.
function fakeLeaseTable(rows) {
  return {
    rows,
    async execute(sql, [stoppedBy, company_id, member_id, device_id]) {
      const stop = /reminders_stopped_at = NOW\(\)/.test(sql);
      let affectedRows = 0;
      for (const r of rows) {
        if (r.company_id == company_id && r.member_id == member_id && r.device_id == device_id && r.returned === 0) {
          r.reminders_stopped_at = stop ? '2026-10-07 12:00:00' : null;
          r.reminders_stopped_by = stoppedBy;
          affectedRows++;
        }
      }
      return [{ affectedRows }];
    },
  };
}

function loadController(pool) {
  const originals = [controllerPath, dbPath, loggerPath].map((p) => [p, require.cache[p]]);
  delete require.cache[controllerPath];
  require.cache[dbPath] = { exports: () => pool };
  require.cache[loggerPath] = { exports: { error() {}, info() {} } };
  const controller = require(controllerPath);
  for (const [p, original] of originals) {
    if (original) require.cache[p] = original; else delete require.cache[p];
  }
  return controller;
}

const lease = (device_id) => ({
  company_id: 61, member_id: 5001, device_id, returned: 0, reminders_stopped_at: null,
  first_name: 'Ada', last_name: 'Lovelace', email: 'ada@student.example', minor: 0, days_overdue: 5,
});

test('stop: solo el dispositivo indicado deja de recibir recordatorios; el otro vencido sigue', async () => {
  const table = fakeLeaseTable([lease(9001), lease(9002)]);
  const { stopLeaseReminders } = loadController(table);

  const res = createResponse();
  await stopLeaseReminders({ uid: 'staff-1', body: { company_id: 61, member_id: 5001, device_id: 9001 } }, res);
  assert.equal(res.statusCode, 200);

  const lost = table.rows.find((r) => r.device_id === 9001);
  const due = table.rows.find((r) => r.device_id === 9002);
  assert.ok(lost.reminders_stopped_at);
  assert.equal(lost.reminders_stopped_by, 'staff-1');
  assert.equal(due.reminders_stopped_at, null);

  // Lo que veria el scheduler (OVERDUE_QUERY filtra reminders_stopped_at IS NULL).
  const pending = table.rows.filter((r) => r.reminders_stopped_at === null);
  const { jobs } = buildReminderJobs(pending, { now: Date.parse('2026-10-07T12:00:00Z') });
  // Un solo correo, y el dispositivo detenido no va en él.
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].leases.map((l) => l.device_id), [9002]);
});

test('resume: reactiva solo ese dispositivo', async () => {
  const table = fakeLeaseTable([lease(9001), lease(9002)]);
  const { stopLeaseReminders, resumeLeaseReminders } = loadController(table);
  for (const device_id of [9001, 9002]) {
    await stopLeaseReminders({ uid: 'staff-1', body: { company_id: 61, member_id: 5001, device_id } }, createResponse());
  }
  const res = createResponse();
  await resumeLeaseReminders({ uid: 'staff-1', body: { company_id: 61, member_id: 5001, device_id: 9002 } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(table.rows.find((r) => r.device_id === 9001).reminders_stopped_at);
  assert.equal(table.rows.find((r) => r.device_id === 9002).reminders_stopped_at, null);
});

test('stop: device_id es obligatorio (sin el no se detiene nada del miembro)', async () => {
  const table = fakeLeaseTable([lease(9001), lease(9002)]);
  const { stopLeaseReminders } = loadController(table);
  const res = createResponse();
  await stopLeaseReminders({ uid: 'staff-1', body: { company_id: 61, member_id: 5001 } }, res);
  assert.equal(res.statusCode, 400);
  assert.ok(table.rows.every((r) => r.reminders_stopped_at === null));
});

test('stop: 404 si ese dispositivo ya fue devuelto o no es del miembro', async () => {
  const table = fakeLeaseTable([{ ...lease(9001), returned: 1 }]);
  const { stopLeaseReminders } = loadController(table);
  const res = createResponse();
  await stopLeaseReminders({ uid: 'staff-1', body: { company_id: 61, member_id: 5001, device_id: 9001 } }, res);
  assert.equal(res.statusCode, 404);
});
