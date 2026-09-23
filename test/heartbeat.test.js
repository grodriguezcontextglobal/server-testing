'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  sendHeartbeat,
  resolveHeartbeatUrl,
  resolveQueueServiceName,
  envKeyFor,
  buildUrl,
  _resetHeartbeatState,
} = require('../helpers/heartbeat');

/* ---------------------------------------------------------------- *
 * Doble de fetch
 * ---------------------------------------------------------------- */

const makeFetch = ({ fail = false } = {}) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (fail) throw new Error('ECONNREFUSED');
    return { ok: true, status: 200 };
  };
  return { fetchImpl, calls };
};

/* ---------------------------------------------------------------- *
 * Nombres y URLs
 * ---------------------------------------------------------------- */

test('envKeyFor normaliza el nombre del servicio a una variable de entorno', () => {
  assert.strictEqual(envKeyFor('queue_bulk'), 'HEARTBEAT_URL_QUEUE_BULK');
  assert.strictEqual(envKeyFor('scheduler-overdue'), 'HEARTBEAT_URL_SCHEDULER_OVERDUE');
});

test('buildUrl respeta una URL que ya trae parámetros', () => {
  const withoutQuery = buildUrl('https://kuma/api/push/abc', { status: 'up', msg: 'OK' });
  assert.ok(withoutQuery.startsWith('https://kuma/api/push/abc?status=up'));

  const withQuery = buildUrl('https://kuma/api/push/abc?token=x', { status: 'up', msg: 'OK' });
  assert.ok(withQuery.includes('?token=x&status=up'), withQuery);
});

test('buildUrl escapa el mensaje y solo incluye ping si es un número', () => {
  const url = buildUrl('https://kuma/push/1', { status: 'down', msg: 'tick falló: a&b c', pingMs: 12.7 });
  assert.ok(url.includes('msg=tick%20fall%C3%B3%3A%20a%26b%20c'), url);
  assert.ok(url.includes('ping=13'), 'el ping se redondea');

  const sinPing = buildUrl('https://kuma/push/1', { status: 'up', msg: 'OK' });
  assert.ok(!sinPing.includes('ping='));
});

test('resolveQueueServiceName usa el PRIMER grupo, el override explícito, o la API', () => {
  assert.strictEqual(resolveQueueServiceName({ QUEUE_GROUP: 'bulk,heavy' }), 'queue_bulk');
  assert.strictEqual(resolveQueueServiceName({ QUEUE_GROUP: 'email' }), 'queue_email');
  assert.strictEqual(resolveQueueServiceName({ HEARTBEAT_SERVICE: 'otro', QUEUE_GROUP: 'bulk' }), 'otro');
  assert.strictEqual(resolveQueueServiceName({}), 'queue_api');
});

test('resolveHeartbeatUrl recorta y devuelve cadena vacía si no está configurada', () => {
  assert.strictEqual(resolveHeartbeatUrl('queue_bulk', { HEARTBEAT_URL_QUEUE_BULK: '  https://k/1  ' }), 'https://k/1');
  assert.strictEqual(resolveHeartbeatUrl('queue_bulk', {}), '');
});

/* ---------------------------------------------------------------- *
 * Sin configurar: silencio absoluto
 * ---------------------------------------------------------------- */

test('sin variable de entorno no sale ni una petición', async () => {
  _resetHeartbeatState();
  const { fetchImpl, calls } = makeFetch();

  const result = await sendHeartbeat('queue_bulk', { env: {}, fetchImpl });

  assert.deepStrictEqual(result, { sent: false, reason: 'disabled' });
  assert.strictEqual(calls.length, 0, 'el código desplegado sin monitor no habla con nadie');
});

/* ---------------------------------------------------------------- *
 * El freno, y lo que lo salta
 * ---------------------------------------------------------------- */

test('el segundo latido dentro del intervalo se frena', async () => {
  _resetHeartbeatState();
  const env = { HEARTBEAT_URL_QUEUE_BULK: 'https://kuma/push/b' };
  const { fetchImpl, calls } = makeFetch();
  let clock = 1_000;

  const first = await sendHeartbeat('queue_bulk', { env, fetchImpl, now: () => clock, minIntervalMs: 60_000 });
  clock += 300; // un tick de QUEUE_POLL_MS=300 después
  const second = await sendHeartbeat('queue_bulk', { env, fetchImpl, now: () => clock, minIntervalMs: 60_000 });

  assert.strictEqual(first.sent, true);
  assert.deepStrictEqual(second, { sent: false, reason: 'throttled' });
  assert.strictEqual(calls.length, 1, '200 ticks por minuto no son 200 peticiones');
});

test('pasado el intervalo vuelve a latir', async () => {
  _resetHeartbeatState();
  const env = { HEARTBEAT_URL_QUEUE_BULK: 'https://kuma/push/b' };
  const { fetchImpl, calls } = makeFetch();
  let clock = 1_000;

  await sendHeartbeat('queue_bulk', { env, fetchImpl, now: () => clock, minIntervalMs: 60_000 });
  clock += 60_001;
  const later = await sendHeartbeat('queue_bulk', { env, fetchImpl, now: () => clock, minIntervalMs: 60_000 });

  assert.strictEqual(later.sent, true);
  assert.strictEqual(calls.length, 2);
});

test('un cambio de estado salta el freno: la caída sale en el acto', async () => {
  _resetHeartbeatState();
  const env = { HEARTBEAT_URL_QUEUE_BULK: 'https://kuma/push/b' };
  const { fetchImpl, calls } = makeFetch();
  let clock = 1_000;

  await sendHeartbeat('queue_bulk', { env, fetchImpl, now: () => clock, minIntervalMs: 60_000 });
  clock += 300;
  const down = await sendHeartbeat('queue_bulk', {
    env, fetchImpl, now: () => clock, minIntervalMs: 60_000,
    status: 'down', msg: 'Mongo caído',
  });

  assert.strictEqual(down.sent, true, 'una caída no espera al próximo minuto');
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[1].url.includes('status=down'));

  // Y la recuperación tampoco espera.
  clock += 300;
  const up = await sendHeartbeat('queue_bulk', { env, fetchImpl, now: () => clock, minIntervalMs: 60_000 });
  assert.strictEqual(up.sent, true);
  assert.ok(calls[2].url.includes('status=up'));
});

test('dos caídas seguidas no repiten la alerta cada 300 ms', async () => {
  _resetHeartbeatState();
  const env = { HEARTBEAT_URL_QUEUE_BULK: 'https://kuma/push/b' };
  const { fetchImpl, calls } = makeFetch();
  let clock = 1_000;
  const opts = () => ({ env, fetchImpl, now: () => clock, minIntervalMs: 60_000, status: 'down', msg: 'x' });

  await sendHeartbeat('queue_bulk', opts());
  clock += 300;
  const repeat = await sendHeartbeat('queue_bulk', opts());

  assert.deepStrictEqual(repeat, { sent: false, reason: 'throttled' });
  assert.strictEqual(calls.length, 1);
});

test('cada servicio lleva su propio freno', async () => {
  _resetHeartbeatState();
  const env = {
    HEARTBEAT_URL_QUEUE_BULK: 'https://kuma/push/b',
    HEARTBEAT_URL_QUEUE_EMAIL: 'https://kuma/push/e',
  };
  const { fetchImpl, calls } = makeFetch();
  const clock = 1_000;

  await sendHeartbeat('queue_bulk', { env, fetchImpl, now: () => clock });
  await sendHeartbeat('queue_email', { env, fetchImpl, now: () => clock });

  assert.strictEqual(calls.length, 2, 'el latido de un worker no silencia al de otro');
});

/* ---------------------------------------------------------------- *
 * Nunca estorbar a lo vigilado
 * ---------------------------------------------------------------- */

test('un monitor caído no lanza ni rompe a quien late', async () => {
  _resetHeartbeatState();
  const env = { HEARTBEAT_URL_QUEUE_BULK: 'https://kuma/push/b' };
  const { fetchImpl, calls } = makeFetch({ fail: true });

  const result = await sendHeartbeat('queue_bulk', { env, fetchImpl });

  assert.deepStrictEqual(result, { sent: false, reason: 'error' });
  assert.strictEqual(calls.length, 1);
});

test('el envío lleva timeout: un monitor que acepta y no responde no cuelga sockets', async () => {
  _resetHeartbeatState();
  const env = { HEARTBEAT_URL_QUEUE_BULK: 'https://kuma/push/b' };
  const { fetchImpl, calls } = makeFetch();

  await sendHeartbeat('queue_bulk', { env, fetchImpl, timeoutMs: 1_000 });

  assert.ok(calls[0].options.signal, 'se pasa un AbortSignal al fetch');
});

test('sin fetch en el runtime se devuelve el motivo, no una excepción', async () => {
  _resetHeartbeatState();
  const env = { HEARTBEAT_URL_QUEUE_BULK: 'https://kuma/push/b' };
  const original = globalThis.fetch;
  globalThis.fetch = undefined;

  try {
    const result = await sendHeartbeat('queue_bulk', { env, now: () => 1 });
    assert.deepStrictEqual(result, { sent: false, reason: 'no-fetch' });
  } finally {
    globalThis.fetch = original;
  }
});

/* ---------------------------------------------------------------- *
 * Dead-man switch de los schedulers
 * ---------------------------------------------------------------- */

test('el scheduler late `up` con el resultado cuando la corrida termina', async () => {
  _resetHeartbeatState();
  const { runWithHeartbeat } = require('../scheduler');
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return { ok: true }; };
  process.env.HEARTBEAT_URL_SCHEDULER_OVERDUE = 'https://kuma/push/s';

  try {
    await runWithHeartbeat('scheduler_overdue', 'overdue-reminders', async () => ({ overdue: 3, queued: 3 }));
    await new Promise((resolve) => setImmediate(resolve)); // el latido no se espera
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].includes('status=up'));
    assert.ok(calls[0].includes('queued'), 'el mensaje lleva el resultado de la corrida');
  } finally {
    globalThis.fetch = original;
    delete process.env.HEARTBEAT_URL_SCHEDULER_OVERDUE;
  }
});

test('si la corrida falla, el scheduler late `down` con el motivo y no propaga', async () => {
  _resetHeartbeatState();
  const { runWithHeartbeat } = require('../scheduler');
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return { ok: true }; };
  process.env.HEARTBEAT_URL_SCHEDULER_CONSENT = 'https://kuma/push/c';

  try {
    await runWithHeartbeat('scheduler_consent', 'consent-expiry', async () => {
      throw new Error('MySQL se fue');
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].includes('status=down'));
    assert.ok(calls[0].includes('MySQL'), calls[0]);
  } finally {
    globalThis.fetch = original;
    delete process.env.HEARTBEAT_URL_SCHEDULER_CONSENT;
  }
});
