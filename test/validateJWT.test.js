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

// Devuelve una función header() que distingue x-token de s-token-lq.
function makeHeaderFn(xToken, sTokenLq = undefined) {
  return (name) => {
    if (name === 'x-token')    return xToken;
    if (name === 's-token-lq') return sTokenLq;
    return undefined;
  };
}

// ─── sin token ────────────────────────────────────────────────────────────────

test('validateJWT: 401 cuando no hay header x-token', (t, done) => {
  const req = { header: makeHeaderFn(undefined) };
  const res = mockRes();
  validateJWT(req, res, () => { done(new Error('next no debería llamarse')); });
  assert.equal(res.statusCode, 401);
  done();
});

// ─── token inválido ───────────────────────────────────────────────────────────

test('validateJWT: 401 con token firmado con seed incorrecta', (t, done) => {
  const token = jwt.sign({ uid: 'abc', sqlStaffId: 1 }, 'wrong-seed', { expiresIn: '1h' });
  const req = { header: makeHeaderFn(token) };
  const res = mockRes();
  validateJWT(req, res, () => { done(new Error('next no debería llamarse')); });
  assert.equal(res.statusCode, 401);
  done();
});

// ─── token válido sin sqlStaffId (token legacy) — sin header fallback ─────────

test('validateJWT: token legado sin sqlStaffId y sin header s-token-lq → sqlStaffId null', (t, done) => {
  const token = makeToken({ uid: '661d7f57b5dd5c170d866933', name: 'Gustavo', tokenVersion: 1 });
  const req = { header: makeHeaderFn(token) }; // s-token-lq ausente
  const res = mockRes();
  validateJWT(req, res, () => {
    assert.equal(req.uid,        '661d7f57b5dd5c170d866933');
    assert.equal(req.sqlStaffId, null);
    done();
  });
});

// ─── la cabecera s-token-lq ya NO se lee (retirada 2026-10-21) ───────────────

test('validateJWT: token sin sqlStaffId + header s-token-lq → sqlStaffId null (la cabecera se ignora)', (t, done) => {
  const token = makeToken({ uid: '661d7f57b5dd5c170d866933', name: 'Gustavo', tokenVersion: 1 });
  const req = { header: makeHeaderFn(token, '42') };
  const res = mockRes();
  validateJWT(req, res, () => {
    assert.equal(req.sqlStaffId, null);
    done();
  });
});

test('validateJWT: sqlStaffId null en payload + header s-token-lq → sigue null', (t, done) => {
  const token = makeToken({ uid: 'u1', name: 'Test', tokenVersion: 2, sqlStaffId: null });
  const req = { header: makeHeaderFn(token, '99') };
  const res = mockRes();
  validateJWT(req, res, () => {
    assert.equal(req.sqlStaffId, null);
    done();
  });
});

test('validateJWT: expone authTime del token, o su iat si no lo lleva', (t, done) => {
  const withAuth = makeToken({ uid: 'u1', authTime: 1000 });
  const req = { header: makeHeaderFn(withAuth) };
  validateJWT(req, mockRes(), () => {
    assert.equal(req.authTime, 1000);
    const legacy = makeToken({ uid: 'u1' });
    const req2 = { header: makeHeaderFn(legacy) };
    validateJWT(req2, mockRes(), () => {
      assert.equal(req2.authTime, jwt.decode(legacy).iat);
      done();
    });
  });
});

// ─── token con sqlStaffId válido — el JWT tiene prioridad sobre el header ─────

test('validateJWT: sqlStaffId en JWT tiene prioridad sobre header s-token-lq', (t, done) => {
  const token = makeToken({ uid: 'u1', name: 'Test', tokenVersion: 2, sqlStaffId: 74 });
  const req = { header: makeHeaderFn(token, '999') }; // header dice 999, JWT dice 74
  const res = mockRes();
  validateJWT(req, res, () => {
    assert.equal(req.sqlStaffId, 74); // JWT gana
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
  const req = { header: makeHeaderFn(token) };
  const res = mockRes();
  validateJWT(req, res, () => {
    assert.equal(req.uid,        '661d7f57b5dd5c170d866933');
    assert.equal(req.sqlStaffId, 74);
    assert.equal(req.name,       'Gustavo');
    done();
  });
});
