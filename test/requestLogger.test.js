'use strict';

/**
 * Registro de peticiones (FedRAMP AU-2 / AU-12).
 *
 *   - Una sola entrada 'http' por petición, al terminar, con método, ruta,
 *     estado, origen y quién (uid).
 *   - La URL va SIN query string: los enlaces firmados llevan el token ahí.
 *   - El logger deja pasar 'http' y requests.log solo recibe ese nivel.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const calls = [];
const loggerPath = path.join(root, 'helpers/logger.js');
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: {
    log: (level, message, meta) => calls.push({ level, message, meta }),
    warn: () => {}, error: () => {}, info: () => {},
  },
};
const { requestLogger } = require('../middlewares/requestLogger');

function fakeReq(url, extra = {}) {
  const headers = { origin: 'https://admin.devitrak.net', 'user-agent': 'ua' };
  return { method: 'POST', originalUrl: url, path: url.split('?')[0], ip: '10.0.0.1', ips: [],
    get: (h) => headers[h.toLowerCase()], ...extra };
}
function fakeRes() {
  return { statusCode: 201, statusMessage: 'Created', get: () => undefined, end() {} };
}

test('una sola entrada http por petición, al terminar, con la ruta sin query y el uid', () => {
  calls.length = 0;
  const req = fakeReq('/api/school/event-invitations/confirm?token=secreto&x=1');
  const res = fakeRes();
  requestLogger(req, res, () => {});
  assert.equal(calls.length, 0, 'nada al entrar');

  req.uid = 'u-1';
  res.end();
  const http = calls.filter((c) => c.level === 'http');
  assert.equal(http.length, 1);
  const { requestInfo, responseInfo } = http[0].meta;
  assert.equal(requestInfo.url, '/api/school/event-invitations/confirm');
  assert.equal(requestInfo.method, 'POST');
  assert.equal(requestInfo.origin, 'https://admin.devitrak.net');
  assert.equal(requestInfo.uid, 'u-1');
  assert.equal(responseInfo.statusCode, 201);
  assert.doesNotMatch(JSON.stringify(http[0]), /secreto/);
});

test('el logger real deja pasar http y requests.log solo acepta ese nivel', () => {
  delete require.cache[loggerPath];
  const logger = require('../helpers/logger');
  assert.equal(logger.level, 'http');
  const requests = logger.transports.find((t) => /requests\.log$/.test(t.filename || ''));
  const combined = logger.transports.find((t) => /combined\.log$/.test(t.filename || ''));
  assert.ok(requests && combined);
  assert.equal(combined.level, 'info', 'combined.log no recibe http');
  const pass = (level) => requests.format.transform({ level, message: 'm' }, {});
  assert.ok(pass('http'));
  assert.equal(pass('info'), false);
  assert.equal(pass('error'), false);
});
