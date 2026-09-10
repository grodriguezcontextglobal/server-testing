'use strict';

const test = require('node:test');
const assert = require('node:assert');

const metrics = require('../helpers/metrics');
const { createRequestMetrics, resolveRoute, resolveTenant } = require('../middlewares/requestMetrics');
const { getReadiness, withTimeout, _resetCache, CRITICAL } = require('../helpers/readiness');

/* ---------------------------------------------------------------- *
 * Doble de Redis
 * ---------------------------------------------------------------- */

const makeRedis = ({ failOnExec = false } = {}) => {
  const hashes = new Map();
  const calls = { hIncrBy: 0, expire: 0, exec: 0 };
  const client = {
    multi() {
      const ops = [];
      const chain = {
        hIncrBy(key, field, value) {
          calls.hIncrBy += 1;
          ops.push(() => {
            const hash = hashes.get(key) || {};
            hash[field] = String(Number(hash[field] || 0) + value);
            hashes.set(key, hash);
          });
          return chain;
        },
        hSet(key, field, value) {
          ops.push(() => {
            const hash = hashes.get(key) || {};
            hash[field] = String(value);
            hashes.set(key, hash);
          });
          return chain;
        },
        expire() { calls.expire += 1; return chain; },
        async exec() {
          calls.exec += 1;
          if (failOnExec) throw new Error('redis down');
          ops.forEach((op) => op());
          return [];
        },
      };
      return chain;
    },
    async keys(pattern) {
      const prefix = pattern.replace(/\*$/, '');
      return [...hashes.keys()].filter((key) => key.startsWith(prefix));
    },
    async hGetAll(key) { return hashes.get(key) || {}; },
    async ping() { return 'PONG'; },
  };
  return { client, hashes, calls, redisFn: async () => client };
};

/* ---------------------------------------------------------------- *
 * Percentiles
 * ---------------------------------------------------------------- */

test('percentile: interpola dentro del bucket que cruza el objetivo', () => {
  // 10 muestras, todas en el bucket (10, 25]. El p50 debe caer a mitad de ese
  // tramo, no en su borde: un percentil que solo devuelve los cortes miente
  // sistematicamente hacia arriba.
  const row = metrics.parseRow({ count: '10', b2: '10' });
  const p50 = metrics.percentile(row, 0.5);
  assert.ok(p50 > 10 && p50 < 25, `p50 deberia estar dentro del bucket, fue ${p50}`);
});

test('percentile: con todo en el bucket mas lento devuelve el maximo observado', () => {
  // Cuando el percentil cae en +Inf no hay corte superior que devolver. Dar el
  // maximo real es lo unico honesto; inventar un numero seria peor que no
  // medir, porque nadie lo cuestionaria.
  const row = metrics.parseRow({ count: '4', over: '4', 'max_ms_p1': '9000' });
  assert.strictEqual(metrics.percentile(row, 0.95), 9000);
});

test('percentile: sin muestras no divide por cero', () => {
  assert.strictEqual(metrics.percentile(metrics.parseRow({}), 0.95), 0);
});

/* ---------------------------------------------------------------- *
 * Agregacion y volcado
 * ---------------------------------------------------------------- */

test('flush: agrega en memoria y vuelca en UN pipeline, no una escritura por peticion', async () => {
  metrics._reset();
  const redis = makeRedis();

  for (let i = 0; i < 500; i++) {
    metrics.record({ route: '/api/db_item/:id', method: 'GET', statusCode: 200, durationMs: 30 });
  }

  const result = await metrics.flush({ redisFn: redis.redisFn });

  assert.strictEqual(result.flushed, 1, 'una ruta distinta, una entrada');
  assert.strictEqual(redis.calls.exec, 1, '500 peticiones -> 1 exec');
  assert.ok(redis.calls.hIncrBy < 20, `campos por ruta, no por peticion (fueron ${redis.calls.hIncrBy})`);

  const [hash] = [...redis.hashes.values()];
  assert.strictEqual(hash.count, '500');
  assert.strictEqual(hash.sum_ms, String(500 * 30));
});

test('flush: un fallo de Redis NO pierde los contadores', async () => {
  // El modo de fallo silencioso mas facil de escribir aqui es descartar lo
  // drenado en el catch. Entonces un hipo de red borra la unica evidencia de
  // un pico de latencia, que es justo el momento en que se consulta.
  metrics._reset();
  const roto = makeRedis({ failOnExec: true });

  for (let i = 0; i < 10; i++) {
    metrics.record({ route: '/api/db_event/:id', method: 'POST', statusCode: 201, durationMs: 40 });
  }
  const failed = await metrics.flush({ redisFn: roto.redisFn });
  assert.strictEqual(failed.flushed, 0);

  // Y al siguiente intento, con Redis sano, tienen que estar los 10.
  const sano = makeRedis();
  await metrics.flush({ redisFn: sano.redisFn });
  const [hash] = [...sano.hashes.values()];
  assert.strictEqual(hash.count, '10', 'los 10 del intento fallido siguen ahi');
});

test('flush: lo repuesto se SUMA a lo que entro mientras Redis estaba caido', async () => {
  metrics._reset();
  const roto = makeRedis({ failOnExec: true });
  metrics.record({ route: '/api/x', method: 'GET', statusCode: 200, durationMs: 5 });
  await metrics.flush({ redisFn: roto.redisFn });

  metrics.record({ route: '/api/x', method: 'GET', statusCode: 200, durationMs: 5 });

  const sano = makeRedis();
  await metrics.flush({ redisFn: sano.redisFn });
  const [hash] = [...sano.hashes.values()];
  assert.strictEqual(hash.count, '2', 'no se pisa: se suma');
});

test('flush: sin nada acumulado no toca Redis', async () => {
  metrics._reset();
  const redis = makeRedis();
  const result = await metrics.flush({ redisFn: redis.redisFn });
  assert.strictEqual(result.flushed, 0);
  assert.strictEqual(redis.calls.exec, 0, 'un cluster en reposo no debe escribir cada 10s');
});

/* ---------------------------------------------------------------- *
 * Cardinalidad: la trampa del multi-tenant
 * ---------------------------------------------------------------- */

test('rutas: pasado el tope, el exceso va a __overflow__ y no crea series nuevas', async () => {
  metrics._reset();
  const redis = makeRedis();

  // Simula lo que hace un escaner de vulnerabilidades: miles de paths unicos.
  for (let i = 0; i < metrics.MAX_ROUTES + 500; i++) {
    metrics.record({ route: `/api/ruta-${i}`, method: 'GET', statusCode: 404, durationMs: 1 });
  }
  await metrics.flush({ redisFn: redis.redisFn });

  assert.ok(
    redis.hashes.size <= metrics.MAX_ROUTES + 1,
    `la cardinalidad debe estar acotada, hubo ${redis.hashes.size} series`
  );
  const overflow = [...redis.hashes.keys()].find((key) => key.includes(metrics.OVERFLOW_ROUTE));
  assert.ok(overflow, 'y el exceso tiene que quedar contado en algun sitio, no perdido');
  assert.strictEqual(Number((redis.hashes.get(overflow)).count), 500);
});

test('tenants: pasado el tope se acumulan en __other__', async () => {
  metrics._reset();
  const redis = makeRedis();

  for (let i = 0; i < metrics.MAX_TENANTS + 50; i++) {
    metrics.record({ route: '/api/x', method: 'GET', statusCode: 200, durationMs: 1, tenant: `v:c${i}` });
  }
  await metrics.flush({ redisFn: redis.redisFn });

  const tenantHash = [...redis.hashes.entries()].find(([key]) => key.endsWith(':tenant'))[1];
  assert.ok(Object.keys(tenantHash).length <= metrics.MAX_TENANTS + 1);
  assert.strictEqual(Number(tenantHash[metrics.OTHER_TENANT]), 50);
});

test('record: nunca lanza, ni con basura por argumento', () => {
  metrics._reset();
  assert.doesNotThrow(() => metrics.record());
  assert.doesNotThrow(() => metrics.record({ durationMs: NaN, statusCode: null }));
  assert.doesNotThrow(() => metrics.record({ route: 123, method: null }));
});

/* ---------------------------------------------------------------- *
 * snapshot
 * ---------------------------------------------------------------- */

test('snapshot: devuelve la vista del cluster con percentiles y tasa de error', async () => {
  metrics._reset();
  const redis = makeRedis();

  for (let i = 0; i < 100; i++) {
    metrics.record({ route: '/api/db_item/:id', method: 'GET', statusCode: i < 5 ? 500 : 200, durationMs: 20 });
  }
  await metrics.flush({ redisFn: redis.redisFn });

  const snap = await metrics.snapshot({ redisFn: redis.redisFn, hours: 1 });
  const endpoint = snap.endpoints.find((e) => e.endpoint.includes('/api/db_item/:id'));

  assert.strictEqual(endpoint.count, 100);
  assert.strictEqual(endpoint.status['5xx'], 5);
  assert.strictEqual(endpoint.errorRate, 0.05);
  assert.ok(endpoint.p95Ms > 0);
  assert.strictEqual(snap.totals.count, 100);
});

/* ---------------------------------------------------------------- *
 * Middleware
 * ---------------------------------------------------------------- */

const makeRes = () => {
  const listeners = {};
  return {
    statusCode: 200,
    on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
    emit(event) { (listeners[event] || []).forEach((fn) => fn()); },
  };
};

test('resolveRoute: agrupa por plantilla, no por la ruta con valores', () => {
  assert.strictEqual(
    resolveRoute({ baseUrl: '/api/db_item', route: { path: '/:id' } }),
    '/api/db_item/:id'
  );
});

test('resolveRoute: lo que no casa ninguna ruta no crea una serie por URL', () => {
  // Sin esto, un escaner probando /wp-admin, /.env, /phpmyadmin... crearia una
  // serie por intento.
  assert.match(resolveRoute({ baseUrl: '', route: null, path: '/.env' }), /__unmatched__/);
});

test('resolveTenant: distingue la fuente verificada de la pista del header', () => {
  assert.strictEqual(resolveTenant({ verifiedCompanyId: 'abc' }), 'v:abc');
  assert.strictEqual(
    resolveTenant({ header: (name) => (name === 'x-company-id' ? ' 62 ' : undefined) }),
    'h:62'
  );
  assert.strictEqual(resolveTenant({ header: () => undefined }), undefined);
});

test('resolveTenant: ignora un header desmedido en vez de meterlo como clave', () => {
  const largo = 'x'.repeat(500);
  assert.strictEqual(resolveTenant({ header: () => largo }), undefined);
});

test('middleware: registra al terminar la respuesta', () => {
  const recorded = [];
  const middleware = createRequestMetrics({ recordFn: (entry) => recorded.push(entry) });
  const res = makeRes();
  let nexted = false;

  middleware({ method: 'POST', baseUrl: '/api/db_item', route: { path: '/new_item' }, header: () => undefined }, res, () => { nexted = true; });
  assert.strictEqual(nexted, true, 'no debe bloquear la cadena');
  assert.strictEqual(recorded.length, 0, 'todavia no ha terminado');

  res.emit('finish');
  assert.strictEqual(recorded.length, 1);
  assert.strictEqual(recorded[0].route, '/api/db_item/new_item');
  assert.strictEqual(recorded[0].method, 'POST');
});

test('middleware: cuenta tambien al cliente que aborta, y solo una vez', () => {
  // Una avalancha de peticiones abortadas es el sintoma de un servidor lento,
  // y sin escuchar `close` seria invisible. Escuchar los dos eventos abre el
  // riesgo de contar doble, que es lo que se afirma aqui.
  const recorded = [];
  const middleware = createRequestMetrics({ recordFn: (entry) => recorded.push(entry) });
  const res = makeRes();

  middleware({ method: 'GET', baseUrl: '/api/x', route: { path: '/' }, header: () => undefined }, res, () => {});
  res.emit('close');
  res.emit('finish');

  assert.strictEqual(recorded.length, 1, 'close + finish = un solo registro');
});

/* ---------------------------------------------------------------- *
 * Readiness
 * ---------------------------------------------------------------- */

const ok = () => async () => ({ ok: true, ms: 1 });
const down = () => async () => ({ ok: false, ms: 1, error: 'boom' });

test('readiness: todo sano responde ready', async () => {
  _resetCache();
  const result = await getReadiness({
    checks: { mysql: ok(), mongo: ok(), redis: ok(), goWorker: ok() },
    force: true,
  });
  assert.strictEqual(result.ready, true);
  assert.strictEqual(result.status, 'ready');
  assert.deepStrictEqual(result.degraded, []);
});

test('readiness: una dependencia CRITICA caida saca el proceso de rotacion', async () => {
  _resetCache();
  const result = await getReadiness({
    checks: { mysql: down(), mongo: ok(), redis: ok(), goWorker: ok() },
    force: true,
  });
  assert.strictEqual(result.ready, false);
  assert.strictEqual(result.status, 'unready');
  assert.deepStrictEqual(result.failedCritical, ['mysql']);
});

test('readiness: Redis o el worker caidos DEGRADAN, no descalifican', async () => {
  // Sacar el proceso de rotacion por esto deja al cliente sin nada en vez de
  // con casi todo: sin Redis se pierden cachés, sin el worker fallan las
  // operaciones masivas, y el resto de la API sigue respondiendo.
  _resetCache();
  const result = await getReadiness({
    checks: { mysql: ok(), mongo: ok(), redis: down(), goWorker: down() },
    force: true,
  });
  assert.strictEqual(result.ready, true, 'sigue apto para recibir trafico');
  assert.strictEqual(result.status, 'degraded');
  assert.deepStrictEqual(result.degraded.sort(), ['goWorker', 'redis']);
});

test('readiness: la lista de criticas es explicita y no incluye a Redis', () => {
  assert.deepStrictEqual(CRITICAL, ['mysql', 'mongo']);
});

test('readiness: cachea, para que pedirlo en bucle no martillee la base de datos', async () => {
  _resetCache();
  let llamadas = 0;
  const contando = () => async () => { llamadas += 1; return { ok: true }; };
  const checks = { mysql: contando(), mongo: contando(), redis: contando(), goWorker: contando() };

  const primera = await getReadiness({ checks, force: true });
  assert.strictEqual(primera.cached, false);
  const base = llamadas;

  for (let i = 0; i < 50; i++) await getReadiness({ checks });
  assert.strictEqual(llamadas, base, '50 peticiones mas, cero comprobaciones nuevas');

  const despues = await getReadiness({ checks, now: () => Date.now() + 60_000 });
  assert.strictEqual(despues.cached, false, 'y al expirar vuelve a comprobar');
});

test('withTimeout: una dependencia colgada devuelve error rapido, no se queda esperando', async () => {
  const empezado = Date.now();
  const result = await withTimeout('colgada', () => new Promise(() => {}), 40);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /timeout/);
  assert.ok(Date.now() - empezado < 1000, 'no debe esperar mas alla del timeout');
});

test('withTimeout: un check que lanza se reporta como caido, no tumba el readiness', async () => {
  const result = await withTimeout('rota', async () => { throw new Error('ECONNREFUSED'); }, 100);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'ECONNREFUSED');
});
