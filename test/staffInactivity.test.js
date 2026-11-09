'use strict';

/**
 * Cuentas de staff inactivas (AC-2(3), 2026-11-09): scheduler/staffInactivity.js
 * y scripts/staff-inactivity.js. El rechazo en el login está en loginLockout.test.js.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  inactivityConfig,
  createdAtOf,
  lastActivityOf,
  findInactive,
  runStaffInactivity,
} = require('../scheduler/staffInactivity');
const { recordSuccessfulLogin, recordFailedLogin, MAX_USER_AGENT } = require('../helpers/accountActivity');
const AdminUser = require('../models/AdminUser');
const { reportRows, backfillPlan } = require('../scripts/staff-inactivity');
const { classify } = require('../scripts/summarize-warn-logs');

const NOW = new Date('2026-11-09T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);
/** ObjectId (hex) creado hace n días. */
const idCreated = (n, tail = '0000000000000001') =>
  Math.floor(daysAgo(n).getTime() / 1000).toString(16).padStart(8, '0') + tail;

describe('inactivityConfig', () => {
  test('por defecto: warn, 90 días, sin exentos', () => {
    const c = inactivityConfig({});
    assert.equal(c.mode, 'warn');
    assert.equal(c.days, 90);
    assert.equal(c.exempt.size, 0);
  });
  test('valores raros caen en el defecto; exentos sin mayúsculas ni espacios', () => {
    const c = inactivityConfig({ STAFF_INACTIVITY_MODE: 'ENFORCE', STAFF_INACTIVITY_DAYS: 'x', STAFF_INACTIVITY_EXEMPT: ' A@x.com, ,b@x.com' });
    assert.equal(c.mode, 'enforce');
    assert.equal(c.days, 90);
    assert.deepEqual([...c.exempt], ['a@x.com', 'b@x.com']);
    assert.equal(inactivityConfig({ STAFF_INACTIVITY_MODE: 'nope' }).mode, 'warn');
    assert.equal(inactivityConfig({ STAFF_INACTIVITY_DAYS: '30' }).days, 30);
  });
});

describe('lastActivityOf', () => {
  test('la más reciente de último login, alta y reactivación', () => {
    const _id = idCreated(400);
    assert.equal(createdAtOf({ _id }).toISOString().slice(0, 10), daysAgo(400).toISOString().slice(0, 10));
    assert.equal(lastActivityOf({ _id, lastLoginAt: daysAgo(100) }).getTime(), daysAgo(100).getTime());
    assert.equal(lastActivityOf({ _id, lastLoginAt: daysAgo(100), reactivatedAt: daysAgo(5) }).getTime(), daysAgo(5).getTime());
  });
  test('sin último login cuenta desde el alta: una cuenta nueva no está inactiva', () => {
    const fresh = { _id: idCreated(10), email: 'new@x.com' };
    assert.deepEqual(findInactive([fresh], { now: NOW, days: 90, exempt: new Set() }).inactive, []);
  });
});

describe('findInactive', () => {
  const users = [
    { _id: idCreated(500, 'a'.repeat(16)), email: 'old@x.com', lastLoginAt: daysAgo(91) },
    { _id: idCreated(500, 'b'.repeat(16)), email: 'edge@x.com', lastLoginAt: daysAgo(89) },
    { _id: idCreated(500, 'c'.repeat(16)), email: 'Boss@x.com', lastLoginAt: daysAgo(200) },
    { _id: idCreated(500, 'd'.repeat(16)), email: 'gone@x.com', lastLoginAt: daysAgo(300), active: false },
  ];
  test('pasa del límite: sí; justo por debajo: no; desactivada: se ignora; exento: aparte', () => {
    const r = findInactive(users, { now: NOW, days: 90, exempt: new Set(['boss@x.com']) });
    assert.deepEqual(r.inactive.map((x) => x.user.email), ['old@x.com']);
    assert.equal(r.inactive[0].daysInactive, 91);
    assert.deepEqual(r.exempt.map((x) => x.user.email), ['Boss@x.com']);
  });
});

function fakeModel(users, { modified = 1 } = {}) {
  const calls = { find: 0, updates: [] };
  return {
    calls,
    model: {
      find: (filter) => {
        calls.find += 1;
        calls.filter = filter;
        return { select: () => ({ lean: async () => users }) };
      },
      updateOne: async (filter, update) => {
        calls.updates.push({ filter, update });
        return { modifiedCount: modified };
      },
    },
  };
}
const quietLogger = () => {
  const lines = [];
  return { lines, warn: (m, d) => lines.push({ m, d }), info: (m, d) => lines.push({ m, d }), error: () => {} };
};

// Estos tests miden desde lastLoginAt: el suelo de STAFF_INACTIVITY_SINCE se
// lleva al pasado. El suelo tiene sus propios tests más abajo.
const OLD_SINCE = { STAFF_INACTIVITY_SINCE: '2000-01-01' };
const ENFORCE = { ...OLD_SINCE, STAFF_INACTIVITY_MODE: 'enforce' };

describe('runStaffInactivity', () => {
  const users = [
    { _id: idCreated(500, 'a'.repeat(16)), email: 'old@x.com', lastLoginAt: daysAgo(120), super_user: false },
    { _id: idCreated(500, 'b'.repeat(16)), email: 'ok@x.com', lastLoginAt: daysAgo(3) },
  ];

  test('warn (por defecto): no escribe, avisa con el texto que cuenta summarize-warn-logs', async () => {
    const { model, calls } = fakeModel(users);
    const logger = quietLogger();
    const activity = [];
    const r = await runStaffInactivity({ AdminUserModel: model, logger, logActivity: async (x) => activity.push(x), env: OLD_SINCE, now: NOW });
    assert.deepEqual(r, { mode: 'warn', days: 90, checked: 2, inactive: 1, disabled: 0, exempt: 0 });
    assert.equal(calls.updates.length, 0);
    assert.equal(activity.length, 0);
    assert.deepEqual(calls.filter, { active: { $ne: false } });
    const line = logger.lines.find((l) => /would disable/.test(l.m));
    assert.equal(line.d.email, 'old@x.com');
    assert.equal(classify({ message: line.m }).mode, 'STAFF_INACTIVITY_MODE');
  });

  test('enforce: active false con fecha y motivo, tokenVersion + 1, y DEACTIVATE en el audit trail', async () => {
    const { model, calls } = fakeModel(users);
    const activity = [];
    const r = await runStaffInactivity({
      AdminUserModel: model, logger: quietLogger(), logActivity: async (x) => activity.push(x),
      env: ENFORCE, now: NOW,
    });
    assert.equal(r.disabled, 1);
    assert.equal(calls.updates.length, 1);
    const { filter, update } = calls.updates[0];
    assert.deepEqual(filter, { _id: users[0]._id, active: { $ne: false } });
    assert.deepEqual(update, {
      $set: { active: false, deactivatedAt: NOW, deactivatedReason: 'inactivity' },
      $inc: { tokenVersion: 1 },
    });
    assert.equal(activity[0].action, 'DEACTIVATE');
    assert.equal(activity[0].target_id, String(users[0]._id));
    assert.equal(activity[0].details.days_inactive, 120);
  });

  test('enforce: si alguien la reactivó entre la lectura y la escritura, no cuenta ni registra', async () => {
    const { model } = fakeModel(users, { modified: 0 });
    const activity = [];
    const r = await runStaffInactivity({
      AdminUserModel: model, logger: quietLogger(), logActivity: async (x) => activity.push(x),
      env: ENFORCE, now: NOW,
    });
    assert.equal(r.disabled, 0);
    assert.equal(activity.length, 0);
  });

  test('enforce: un exento no se toca', async () => {
    const { model, calls } = fakeModel(users);
    const r = await runStaffInactivity({
      AdminUserModel: model, logger: quietLogger(), logActivity: async () => {},
      env: { ...ENFORCE, STAFF_INACTIVITY_EXEMPT: 'OLD@x.com' }, now: NOW,
    });
    assert.equal(r.exempt, 1);
    assert.equal(calls.updates.length, 0);
  });

  test('off: ni siquiera lee', async () => {
    const { model, calls } = fakeModel(users);
    const r = await runStaffInactivity({ AdminUserModel: model, logger: quietLogger(), env: { STAFF_INACTIVITY_MODE: 'off' }, now: NOW });
    assert.equal(r.mode, 'off');
    assert.equal(calls.find, 0);
  });
});

describe('helpers/accountActivity', () => {
  test('login correcto: fecha, IP, navegador (recortado) y loginCount + 1', async () => {
    const calls = [];
    const ua = 'x'.repeat(MAX_USER_AGENT + 50);
    recordSuccessfulLogin({ updateOne: async (f, u) => calls.push({ f, u }) }, 'u1', { ip: '10.0.0.1', userAgent: ua, now: NOW, connected: true });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls[0].f, { _id: 'u1' });
    assert.deepEqual(calls[0].u.$inc, { loginCount: 1 });
    assert.equal(calls[0].u.$set.lastLoginAt, NOW);
    assert.equal(calls[0].u.$set.lastLoginIp, '10.0.0.1');
    assert.equal(calls[0].u.$set.lastLoginUserAgent.length, MAX_USER_AGENT);
  });
  test('login fallido: lastFailedLoginAt', async () => {
    const calls = [];
    recordFailedLogin({ updateOne: async (f, u) => calls.push({ f, u }) }, 'u1', { now: NOW, connected: true });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls, [{ f: { _id: 'u1' }, u: { $set: { lastFailedLoginAt: NOW } } }]);
  });
  test('sin Mongo, sin uid, sin updateOne o con error: no hace nada y no lanza', async () => {
    const calls = [];
    recordSuccessfulLogin({ updateOne: async () => calls.push(1) }, 'u1', { connected: false });
    recordFailedLogin({ updateOne: async () => calls.push(1) }, null, { connected: true });
    recordSuccessfulLogin({}, 'u1', { connected: true });
    recordSuccessfulLogin({ updateOne: async () => { throw new Error('boom'); } }, 'u1', { connected: true });
    recordFailedLogin({ updateOne: () => { throw new Error('sync boom'); } }, 'u1', { connected: true });
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 0);
  });
});

describe('models/AdminUser', () => {
  const hooks = AdminUser.schema.s.hooks;
  const runPre = (name, ctx) => new Promise((res, rej) => hooks.execPre(name, ctx, [], (e) => (e ? rej(e) : res())));

  test('passwordChangedAt: en save() cuando cambia la contraseña, no en otro save', async () => {
    const doc = new AdminUser({ name: 'a', lastName: 'b', email: 'e@x.com', password: 'hash' });
    await runPre('save', doc);
    assert.ok(doc.passwordChangedAt instanceof Date);
    doc.passwordChangedAt = null;
    doc.$__reset();
    doc.name = 'otro';
    await runPre('save', doc);
    assert.equal(doc.passwordChangedAt, null);
  });

  test('passwordChangedAt: en findOneAndUpdate / updateOne que escriben password, y solo en esos', async () => {
    const q = AdminUser.findOneAndUpdate({ _id: '64b000000000000000000001' }, { $set: { password: 'h', mfaResetPending: false } });
    await runPre('findOneAndUpdate', q);
    assert.ok(q.getUpdate().$set.passwordChangedAt instanceof Date);
    const q2 = AdminUser.updateOne({ _id: '64b000000000000000000001' }, { $set: { name: 'x' } });
    await runPre('updateOne', q2);
    assert.equal(q2.getUpdate().$set.passwordChangedAt, undefined);
  });

  test('IP y navegador del último login no salen por defecto', () => {
    assert.equal(AdminUser.schema.path('lastLoginIp').options.select, false);
    assert.equal(AdminUser.schema.path('lastLoginUserAgent').options.select, false);
    assert.notEqual(AdminUser.schema.path('lastLoginAt').options.select, false);
  });
});

describe('scripts/staff-inactivity.js', () => {
  test('backfillPlan: solo donde falta o es más antiguo que el último LOGIN del audit trail', () => {
    const users = [
      { _id: 'a', email: 'a@x.com', lastLoginAt: null },
      { _id: 'b', email: 'b@x.com', lastLoginAt: daysAgo(1) },
      { _id: 'c', email: 'c@x.com', lastLoginAt: daysAgo(50) },
      { _id: 'd', email: 'd@x.com' },
    ];
    const logins = new Map([['a', daysAgo(30)], ['b', daysAgo(10)], ['c', daysAgo(20)]]);
    assert.deepEqual(backfillPlan(users, logins).map((p) => [p.email, p.to.getTime()]), [
      ['a@x.com', daysAgo(30).getTime()],
      ['c@x.com', daysAgo(20).getTime()],
    ]);
  });

  test('reportRows: marca a quién desactivaría y ordena por días de inactividad', () => {
    const rows = reportRows(
      [
        { _id: idCreated(500, 'a'.repeat(16)), email: 'recent@x.com', lastLoginAt: daysAgo(2) },
        { _id: idCreated(500, 'b'.repeat(16)), email: 'stale@x.com', lastLoginAt: daysAgo(100) },
        { _id: idCreated(500, 'c'.repeat(16)), email: 'off@x.com', active: false, deactivatedAt: daysAgo(1), deactivatedReason: 'inactivity' },
      ],
      { now: NOW, days: 90, exempt: new Set() }
    );
    assert.deepEqual(rows.map((r) => [r.email, r.would_disable]), [
      ['off@x.com', false],
      ['stale@x.com', true],
      ['recent@x.com', false],
    ]);
    assert.match(rows[0].deactivated, /inactivity/);
  });
});

describe('STAFF_INACTIVITY_SINCE: el reloj de todas las cuentas empieza el 2026-11-09', () => {
  const longAgo = [
    { _id: idCreated(900, 'e'.repeat(16)), email: 'ancient@x.com', lastLoginAt: daysAgo(400) },
    { _id: idCreated(900, 'f'.repeat(16)), email: 'never@x.com' },
  ];

  test('por defecto el suelo es 2026-11-09 y una fecha mala vuelve al defecto', () => {
    assert.equal(inactivityConfig({}).since.toISOString(), '2026-11-09T00:00:00.000Z');
    assert.equal(inactivityConfig({ STAFF_INACTIVITY_SINCE: 'ayer' }).since.toISOString(), '2026-11-09T00:00:00.000Z');
    assert.equal(inactivityConfig({ STAFF_INACTIVITY_SINCE: '2027-01-01' }).since.toISOString(), '2027-01-01T00:00:00.000Z');
  });

  test('hoy: nadie está inactivo, aunque su último login sea de hace 400 días o nunca haya entrado', async () => {
    const { model, calls } = fakeModel(longAgo);
    const r = await runStaffInactivity({
      AdminUserModel: model, logger: quietLogger(), logActivity: async () => {},
      env: { STAFF_INACTIVITY_MODE: 'enforce' }, now: NOW,
    });
    assert.equal(r.inactive, 0);
    assert.equal(calls.updates.length, 0);
  });

  test('el día 89 después todavía no; el 90 (2027-02-07) sí, y sin escribir fechas inventadas en la cuenta', async () => {
    const cfg = inactivityConfig({});
    const at = (d) => new Date(cfg.since.getTime() + d * 86400000 + 12 * 3600000);
    assert.equal(findInactive(longAgo, { ...cfg, now: at(89) }).inactive.length, 0);
    const due = findInactive(longAgo, { ...cfg, now: at(90) }).inactive;
    assert.deepEqual(due.map((x) => x.user.email), ['ancient@x.com', 'never@x.com']);
    assert.equal(at(90).toISOString().slice(0, 10), '2027-02-07');
    assert.equal(longAgo[1].lastLoginAt, undefined);
  });

  test('quien entra después del suelo cuenta desde su login', () => {
    const cfg = inactivityConfig({});
    const now = new Date('2027-06-01T12:00:00Z');
    const user = { _id: idCreated(900, '1'.repeat(16)), email: 'u@x.com', lastLoginAt: new Date('2027-05-01T00:00:00Z') };
    assert.equal(findInactive([user], { ...cfg, now }).inactive.length, 0);
    assert.equal(lastActivityOf(user, cfg.since).toISOString(), '2027-05-01T00:00:00.000Z');
  });
});
