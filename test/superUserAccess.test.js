'use strict';

/**
 * scripts/super-user-access.js (AC-6, 2026-11-10): quitar el super_user de
 * plataforma a cuentas concretas sin dejar la plataforma sin ninguno.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { revokePlan, grantPlan, onlyPlan } = require('../scripts/super-user-access');

const su = [
  { _id: '1', email: 'ops@contextglobal.com' },
  { _id: '2', email: 'qa@qa.com' },
  { _id: '3', email: 'wsx@wsx.com' },
];

test('revoca las pedidas (sin mayúsculas ni espacios) y avisa de las que no son super_user', () => {
  const { revoke, notSuperUser } = revokePlan(su, [' QA@qa.com', 'wsx@wsx.com', 'nadie@x.com', 'qa@qa.com'], 'ops@contextglobal.com');
  assert.deepEqual(revoke.map((u) => u.email), ['qa@qa.com', 'wsx@wsx.com']);
  assert.deepEqual(notSuperUser, ['nadie@x.com']);
});

test('quien lo hace no puede estar en la lista, y tiene que ser super_user', () => {
  assert.throws(() => revokePlan(su, ['ops@contextglobal.com'], 'OPS@contextglobal.com'), /in the revoke list/);
  assert.throws(() => revokePlan(su, ['qa@qa.com'], 'otro@x.com'), /not a super_user/);
});

test('nunca deja la plataforma sin super_user, y una lista vacía es un error', () => {
  // --by tiene que ser super_user y no puede estar en la lista: siempre queda él.
  const onlyOps = revokePlan([su[0]], ['x@x.com'], 'ops@contextglobal.com');
  assert.deepEqual(onlyOps.revoke, []);
  assert.throws(() => revokePlan(su, ['', ' '], 'ops@contextglobal.com'), /at least one email/);
  // Revocar a todos menos a quien lo hace es válido: queda uno.
  assert.equal(revokePlan(su, ['qa@qa.com', 'wsx@wsx.com'], 'ops@contextglobal.com').revoke.length, 2);
});

test('grant: da el flag a cuentas activas que no lo tienen; separa inexistentes, ya super_user y desactivadas', () => {
  const accounts = [
    { _id: '10', email: 'grodriguez@contextglobal.com', super_user: false, active: true },
    { _id: '11', email: 'cacaminero@contextglobal.com', super_user: false },
    { _id: '1', email: 'ops@contextglobal.com', super_user: true, active: true },
    { _id: '12', email: 'off@contextglobal.com', super_user: false, active: false },
  ];
  const plan = grantPlan(
    accounts,
    ['GRodriguez@contextglobal.com ', 'cacaminero@contextglobal.com', 'ops@contextglobal.com', 'off@contextglobal.com', 'nadie@x.com'],
    'ops@contextglobal.com',
    su
  );
  assert.deepEqual(plan.grant.map((u) => u.email), ['grodriguez@contextglobal.com', 'cacaminero@contextglobal.com']);
  assert.deepEqual(plan.already, ['ops@contextglobal.com']);
  assert.deepEqual(plan.inactive, ['off@contextglobal.com']);
  assert.deepEqual(plan.missing, ['nadie@x.com']);
});

test('grant: solo un super_user puede darlo, y una lista vacía es un error', () => {
  assert.throws(() => grantPlan([], ['a@x.com'], 'qa@qa.co', su), /not a super_user/);
  assert.throws(() => grantPlan([], [' '], 'ops@contextglobal.com', su), /at least one email/);
});

test('only: dentro del dominio deja exactamente la lista; clientes y Gmail no se tocan', () => {
  const current = [
    { _id: '1', email: 'fstarmark@contextglobal.com' },
    { _id: '2', email: 'mlkanka@contextglobal.com' },
    { _id: '3', email: 'info@invoxia.cc' },
    { _id: '4', email: 'qa@qa.com' },
    { _id: '5', email: 'cliente@gmail.com' },
  ];
  const accounts = [
    { _id: '1', email: 'fstarmark@contextglobal.com', super_user: true, active: true },
    { _id: '10', email: 'grodriguez@contextglobal.com', super_user: false, active: true },
    { _id: '11', email: 'cacaminero@contextglobal.com', super_user: false, active: true },
  ];
  const keep = ['fstarmark@contextglobal.com', 'grodriguez@contextglobal.com', 'cacaminero@contextglobal.com'];
  const plan = onlyPlan(accounts, keep, 'fstarmark@contextglobal.com', current, '@ContextGlobal.com');
  assert.deepEqual(plan.grant.map((u) => u.email), ['grodriguez@contextglobal.com', 'cacaminero@contextglobal.com']);
  assert.deepEqual(plan.revoke.map((u) => u.email), ['mlkanka@contextglobal.com']);
});

test('only: --domain es obligatorio y la lista tiene que ser de ese dominio', () => {
  const current = [{ _id: '1', email: 'ops@contextglobal.com' }];
  const accounts = [{ _id: '1', email: 'ops@contextglobal.com', super_user: true }];
  assert.throws(() => onlyPlan(accounts, ['ops@contextglobal.com'], 'ops@contextglobal.com', current), /needs --domain/);
  assert.throws(
    () => onlyPlan(accounts, ['ops@contextglobal.com', 'x@gmail.com'], 'ops@contextglobal.com', current, 'contextglobal.com'),
    /must be @contextglobal\.com \(x@gmail\.com\)/
  );
});

test('only: --by tiene que estar en la lista y todas las cuentas tienen que existir y estar activas', () => {
  const current = [{ _id: '1', email: 'ops@contextglobal.com' }];
  const accounts = [{ _id: '1', email: 'ops@contextglobal.com', super_user: true }];
  assert.throws(() => onlyPlan(accounts, ['otra@contextglobal.com'], 'ops@contextglobal.com', current, 'contextglobal.com'), /must be in the --only list/);
  assert.throws(() => onlyPlan(accounts, ['ops@contextglobal.com', 'typo@contextglobal.com'], 'ops@contextglobal.com', current, 'contextglobal.com'), /missing: typo@contextglobal.com/);
  const withOff = [...accounts, { _id: '2', email: 'off@contextglobal.com', super_user: false, active: false }];
  assert.throws(() => onlyPlan(withOff, ['ops@contextglobal.com', 'off@contextglobal.com'], 'ops@contextglobal.com', current, 'contextglobal.com'), /disabled: off@contextglobal.com/);
});
