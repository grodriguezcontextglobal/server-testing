'use strict';

/**
 * A10 (2026-10-28): logs de una línea JSON con hora UTC y proceso, y la
 * muestra de RAM/CPU de cada proceso Node (helpers/runtimeMetrics.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRuntimeMetrics } = require('../helpers/runtimeMetrics');

test('el logger escribe una línea JSON con hora ISO UTC, host, pid y rol', () => {
  const loggerPath = path.join(__dirname, '..', 'helpers', 'logger.js');
  delete require.cache[loggerPath];
  const logger = require(loggerPath);
  const info = logger.format.transform({ level: 'warn', message: 'm', ...logger.defaultMeta, nested: { a: 1 } }, {});
  const line = info[Symbol.for('message')];
  assert.doesNotMatch(line, /\n/, 'una sola línea');
  const parsed = JSON.parse(line);
  assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(parsed.pid, process.pid);
  assert.ok(parsed.host && parsed.role);
  assert.deepEqual(parsed.nested, { a: 1 });
});

test('processRole: worker de la cola, instancia de pm2 o script', () => {
  const { processRole } = require('../helpers/logger');
  const saved = { g: process.env.QUEUE_GROUP, i: process.env.NODE_APP_INSTANCE };
  try {
    process.env.QUEUE_GROUP = 'bulk';
    assert.equal(processRole(), 'worker:bulk');
    delete process.env.QUEUE_GROUP;
    process.env.NODE_APP_INSTANCE = '2';
    assert.equal(processRole(), 'api:2');
  } finally {
    if (saved.g === undefined) delete process.env.QUEUE_GROUP;
    else process.env.QUEUE_GROUP = saved.g;
    if (saved.i === undefined) delete process.env.NODE_APP_INSTANCE;
    else process.env.NODE_APP_INSTANCE = saved.i;
  }
});

test('la muestra lleva memoria en MB, CPU del intervalo y event loop en ms', () => {
  let t = 0;
  const cpu = { user: 0, system: 0 };
  const loop = { percentile: (q) => (q === 50 ? 2e6 : 15e6), max: 40e6, reset() { this.resets = (this.resets || 0) + 1; } };
  const rm = createRuntimeMetrics({
    write: () => {},
    now: () => t,
    memoryUsage: () => ({ rss: 300 * 1048576, heapUsed: 120 * 1048576, heapTotal: 150 * 1048576, external: 10 * 1048576, arrayBuffers: 1048576 }),
    // 500 ms de CPU en 1 s de reloj = 50 % de un núcleo.
    cpuUsage: (prev) => (prev ? { user: cpu.user - prev.user, system: cpu.system - prev.system } : { ...cpu }),
    loop,
    freemem: () => 8 * 1024 * 1048576,
    totalmem: () => 32 * 1024 * 1048576,
  });
  t = 1000;
  cpu.user = 400000;
  cpu.system = 100000;
  const s = rm.sample();
  assert.equal(s.type, 'runtime_metrics');
  assert.equal(s.rss_mb, 300);
  assert.equal(s.heap_used_mb, 120);
  assert.equal(s.cpu_pct, 50);
  assert.equal(s.loop_p50_ms, 2);
  assert.equal(s.loop_p99_ms, 15);
  assert.equal(s.loop_max_ms, 40);
  assert.equal(s.sys_total_mb, 32768);
  assert.equal(s.sys_free_mb, 8192);
  assert.equal(loop.resets, 1, 'cada muestra cubre solo su intervalo');
});

test('start escribe cada intervalo, una sola vez, y 0 lo apaga', async () => {
  const written = [];
  const loop = { percentile: () => 0, max: 0, reset() {}, enable() { this.on = true; }, disable() { this.on = false; } };
  const rm = createRuntimeMetrics({ write: (r) => written.push(r), loop });
  assert.equal(rm.start(0), false);
  assert.equal(rm.start(10), true);
  assert.equal(rm.start(10), false, 'una sola vez');
  // Hasta 2 escrituras o 1 s: una ventana fija de 35 ms fallaba con la suite
  // entera en paralelo (los timers llegan tarde con la máquina cargada).
  for (const deadline = Date.now() + 1000; written.length < 2 && Date.now() < deadline; ) {
    await new Promise((r) => setTimeout(r, 10));
  }
  rm.stop();
  assert.ok(written.length >= 2);
  assert.equal(loop.on, false);
});

test('startRuntimeMetrics respeta RUNTIME_METRICS_INTERVAL_SEC=0', () => {
  const saved = process.env.RUNTIME_METRICS_INTERVAL_SEC;
  process.env.RUNTIME_METRICS_INTERVAL_SEC = '0';
  try {
    assert.equal(require('../helpers/runtimeMetrics').startRuntimeMetrics(), false);
  } finally {
    if (saved === undefined) delete process.env.RUNTIME_METRICS_INTERVAL_SEC;
    else process.env.RUNTIME_METRICS_INTERVAL_SEC = saved;
  }
});
