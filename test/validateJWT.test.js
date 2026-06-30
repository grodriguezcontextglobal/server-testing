'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const jwt    = require('jsonwebtoken');

const SEED = 'test-seed-for-tests';
process.env.SECRET_JWT_SEED = SEED;

const { validateJWT } = require('../middlewares/validate-jwt');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload)  { this.body = payload;   return this; },
  };
}

function makeToken(payload, expiresIn = '1h') {
  return jwt.sign(payload, SEED, { expiresIn });
}

// ─── sin token ────────────────────────────────────────────────────────────────

test('validateJWT: 401 cuando no hay header x-token', (t, done) => {
  const req = { header: () => undefined };
  const res = mockRes();
  validateJWT(req, res, () => { done(new Error('next no debería llamarse')); });
  assert.equal(res.statusCode, 401);
  done();
});

// ─── token inválido ───────────────────────────────────────────────────────────

test('validateJWT: 401 con token firmado con seed incorrecta', (t, done) => {
  const token = jwt.sign({ uid: 'abc', sqlStaffId: 1 }, 'wrong-seed', { expiresIn: '1h' });
  const req = { header: () => token };
  const res = mockRes();
  validateJWT(req, res, () => { done(new Error('next no debería llamarse')); });
  assert.equal(res.statusCode, 401);
  done();
});

// ─── token válido sin sqlStaffId (token legacy) ───────────────────────────────

test('validateJWT: next() con token legado — sqlStaffId queda null', (t, done) => {
  const token = makeToken({ uid: '661d7f57b5dd5c170d866933', name: 'Gustavo', tokenVersion: 1 });
  const req = { header: () => token };
  const res = mockRes();
  validateJWT(req, res, () => {
    assert.equal(req.uid,        '661d7f57b5dd5c170d866933');
    assert.equal(req.sqlStaffId, null);
    done();
  });
});

// ─── token válido con sqlStaffId ─────────────────────────────────────────────

test('validateJWT: extrae sqlStaffId INT del payload y lo setea en request', (t, done) => {
  const token = makeToken({
    uid: '661d7f57b5dd5c170d866933',
    name: 'Gustavo',
    tokenVersion: 1,
    sqlStaffId: 74,
  });
  const req = { header: () => token };
  const res = mockRes();
  validateJWT(req, res, () => {
    assert.equal(req.uid,        '661d7f57b5dd5c170d866933');
    assert.equal(req.sqlStaffId, 74);
    assert.equal(req.name,       'Gustavo');
    done();
  });
});
