'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { rateLimit } = require('express-rate-limit');

const { normalizeForwardedFor, stripPort, realIpFromLocalProxy } = require('../middlewares/normalizeForwardedFor');

/**
 * Lo que llega a Node en prod: IIS (ARR) añade al final de X-Forwarded-For la
 * IP del salto anterior CON su puerto, y el puerto cambia en cada conexión.
 * Con `trust proxy` = 1, req.ip es esa última entrada.
 */
const xff = (port) => `200.10.20.30, 172.16.40.2:${port}`;

const withServer = async ({ normalize }, run) => {
  const app = express();
  app.set('trust proxy', 1);
  if (normalize) app.use(normalizeForwardedFor);
  const state = { handlerRuns: 0, ips: [] };
  // Sin keyGenerator: el por defecto, que es el que valida la IP y lanzaba
  // ERR_ERL_INVALID_IP_ADDRESS (como members/my-devices y las invitaciones).
  app.post(
    '/limited',
    rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: true, legacyHeaders: false }),
    (req, res) => {
      state.handlerRuns += 1;
      state.ips.push(req.ip);
      res.status(200).json({ ok: true });
    },
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base, state);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const post = (base, port, realIp) =>
  fetch(`${base}/limited`, {
    method: 'POST',
    headers: { 'x-forwarded-for': xff(port), ...(realIp ? { 'x-real-ip': realIp } : {}) },
  });

test('stripPort quita el puerto de IPv4 e IPv6 entre corchetes y deja lo demás', () => {
  assert.strictEqual(stripPort('172.16.40.2:50444'), '172.16.40.2');
  assert.strictEqual(stripPort(' 200.10.20.30 '), '200.10.20.30');
  assert.strictEqual(stripPort('[2001:db8::1]:443'), '2001:db8::1');
  assert.strictEqual(stripPort('2001:db8::1'), '2001:db8::1');
  assert.strictEqual(stripPort('unknown'), 'unknown');
});

test('con el puerto en X-Forwarded-For, cada puerto era una IP distinta y el límite no frenaba nada', async () => {
  await withServer({ normalize: false }, async (base, state) => {
    for (const port of [50001, 50002, 50003, 50004]) {
      assert.strictEqual((await post(base, port)).status, 200);
    }
    assert.strictEqual(state.handlerRuns, 4);
    assert.match(state.ips[0], /:50001$/);
  });
});

test('normalizado, req.ip llega sin puerto y el límite cuenta la misma IP', async () => {
  await withServer({ normalize: true }, async (base, state) => {
    const statuses = [];
    for (const port of [50001, 50002, 50003, 50004]) statuses.push((await post(base, port)).status);
    assert.deepStrictEqual(statuses, [200, 200, 429, 429]);
    assert.strictEqual(state.handlerRuns, 2);
    assert.deepStrictEqual(state.ips, ['172.16.40.2', '172.16.40.2']);
  });
});

test('con X-Real-IP (NGINX) cada cliente tiene su propio cubo, no el de NGINX', async () => {
  await withServer({ normalize: true }, async (base, state) => {
    const a = [];
    for (const port of [50001, 50002, 50003]) a.push((await post(base, port, '96.94.214.222')).status);
    const b = (await post(base, 50004, '34.12.54.131')).status;
    assert.deepStrictEqual(a, [200, 200, 429]);
    assert.strictEqual(b, 200);
    assert.deepStrictEqual(state.ips, ['96.94.214.222', '96.94.214.222', '34.12.54.131']);
  });
});

test('X-Real-IP solo vale desde loopback y si es una IP', () => {
  const req = (remoteAddress, realIp) => ({ socket: { remoteAddress }, headers: { 'x-real-ip': realIp } });
  assert.strictEqual(realIpFromLocalProxy(req('127.0.0.1', '96.94.214.222')), '96.94.214.222');
  assert.strictEqual(realIpFromLocalProxy(req('::ffff:127.0.0.1', '96.94.214.222:443')), '96.94.214.222');
  assert.strictEqual(realIpFromLocalProxy(req('10.0.0.5', '96.94.214.222')), null);
  assert.strictEqual(realIpFromLocalProxy(req('127.0.0.1', 'evil, 1.2.3.4')), null);
  assert.strictEqual(realIpFromLocalProxy(req('127.0.0.1', undefined)), null);
});

test('sin X-Forwarded-For no toca nada', async () => {
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  normalizeForwardedFor(req, {}, () => {});
  assert.strictEqual(req.headers['x-forwarded-for'], undefined);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(req, 'ip'), false);
});
