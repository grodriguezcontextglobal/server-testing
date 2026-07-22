'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createAuditPiiAccess } = require(path.resolve(__dirname, '../middlewares/auditPiiAccess.js'));

// fake res that captures the 'finish' listener so the test can fire it on demand.
const makeRes = (statusCode = 200) => {
  let finishCb = null;
  return {
    statusCode,
    on: (evt, cb) => { if (evt === 'finish') finishCb = cb; },
    fireFinish: () => finishCb && finishCb(),
  };
};

test('logs a PII access record on finish with the right payload', () => {
  const calls = [];
  const mw = createAuditPiiAccess((d) => calls.push(d))('SchoolPII');
  const req = {
    uid: 'admin123', method: 'POST', baseUrl: '/api/school', path: '/roster',
    body: { company_id: 61, member_id: 5 }, ip: '1.2.3.4',
    get: (h) => (h === 'user-agent' ? 'jest' : ''),
  };
  const res = makeRes(200);
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  assert.equal(nexted, true);     // never blocks the request
  assert.equal(calls.length, 0);  // nothing logged until the response finishes
  res.fireFinish();
  assert.equal(calls.length, 1);
  const d = calls[0];
  assert.equal(d.staff_member_id, 'admin123');
  assert.equal(d.company_id, '61');
  assert.equal(d.action, 'READ');       // POST -> READ
  assert.equal(d.target_model, 'SchoolPII');
  assert.equal(d.target_id, '5');
  assert.equal(d.details.route, '/api/school/roster');
  assert.equal(d.details.status, 200);
  assert.equal(d.ip_address, '1.2.3.4');
  assert.equal(d.device_info, 'jest');
});

test('skips logging when unauthenticated (no uid)', () => {
  const calls = [];
  const mw = createAuditPiiAccess((d) => calls.push(d))('SchoolPII');
  const res = makeRes(401);
  mw({ method: 'POST', body: { company_id: 61 } }, res, () => {});
  res.fireFinish();
  assert.equal(calls.length, 0);
});

test('skips logging when no company_id is resolvable', () => {
  const calls = [];
  const mw = createAuditPiiAccess((d) => calls.push(d))('SchoolPII');
  const res = makeRes(200);
  mw({ uid: 'admin123', method: 'GET', body: {} }, res, () => {});
  res.fireFinish();
  assert.equal(calls.length, 0);
});

test('records a denied (403) access, honoring an explicit action override', () => {
  const calls = [];
  const mw = createAuditPiiAccess((d) => calls.push(d))('SchoolPII', 'DELETE');
  const res = makeRes(403);
  mw({ uid: 'u1', method: 'DELETE', baseUrl: '/api/school', path: '/guardians', body: { company_id: 9 } }, res, () => {});
  res.fireFinish();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'DELETE');
  assert.equal(calls[0].details.status, 403);
});
