'use strict';

// B2.2 — the canonical action / target_model list the report's filter dropdown
// is built from. The point of the ask: a fee charge was logged as "CREATE a
// Fee", which reads wrong in an audit export a school hands to a district.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTIVITY_ACTIONS,
  ACTIVITY_TARGET_MODELS,
} = require('../constants/activityVocabulary');

test('the fee verbs the frontend asked for exist', () => {
  for (const action of ['CHARGE', 'REFUND', 'WAIVE']) {
    assert.ok(ACTIVITY_ACTIONS.includes(action), `${action} missing`);
  }
});

test('the school-track target models exist', () => {
  for (const model of ['Fee', 'Lease', 'Member', 'Consent']) {
    assert.ok(ACTIVITY_TARGET_MODELS.includes(model), `${model} missing`);
  }
});

test('the verbs already written by admin.js / event.js / inventory.js are kept', () => {
  for (const action of ['LOGIN', 'CREATE', 'UPDATE', 'DELETE', 'FORCE_LOGOUT']) {
    assert.ok(ACTIVITY_ACTIONS.includes(action), `${action} missing`);
  }
});

test('no duplicates — the dropdown must not list a verb twice', () => {
  assert.equal(new Set(ACTIVITY_ACTIONS).size, ACTIVITY_ACTIONS.length);
  assert.equal(new Set(ACTIVITY_TARGET_MODELS).size, ACTIVITY_TARGET_MODELS.length);
});

test('the vocabulary endpoint publishes both lists', () => {
  const { getActivityVocabulary } = require('../controller/staffActivityLog');
  let payload = null;
  getActivityVocabulary({}, { json: (body) => { payload = body; return body; } });
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.actions, ACTIVITY_ACTIONS);
  assert.deepEqual(payload.target_models, ACTIVITY_TARGET_MODELS);
});

test('the write path is NOT gated on the vocabulary — an audit entry is never dropped', async () => {
  const { createRegisterStaffActivity } = require('../controller/staffActivityLog');
  const logged = [];
  const controller = createRegisterStaffActivity({
    findAdminUserFn: async () => ({ id: 'U1', company: 'C1' }),
    logStaffActivityFn: async (data) => logged.push(data),
  });

  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  // a verb that is not in the list must still be recorded
  await controller(
    { uid: 'U1', body: { action: 'SOMETHING_NEW', target_model: 'Whatever' }, headers: {} },
    res
  );

  assert.equal(res.statusCode, 202);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].action, 'SOMETHING_NEW');
});
