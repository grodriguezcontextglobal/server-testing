'use strict';

/**
 * Uso de memoria y CPU de cada proceso Node, una línea JSON por minuto en
 * logs/runtime-metrics.log (A10, 2026-10-28).
 *
 * Para qué: dimensionar la máquina de destino de la migración (Oracle, AWS o
 * Azure) con datos medidos y no con la foto de DESIGN_capacity_limits.md (32 GB,
 * 25 libres, un solo día). Lo escribe cada instancia de la API y cada worker de
 * la cola, así que se ve qué proceso usa cuánto y si alguno crece sin parar.
 * scripts/summarize-ram.js lo resume; scripts/measure-ram.ps1 mide la máquina
 * entera (bases de datos, IIS, el worker de Go) desde fuera.
 *
 * Campos (MB y ms):
 *   rss_mb            memoria del proceso según el sistema operativo
 *   heap_used_mb      heap de V8 en uso; si solo crece, es una fuga
 *   heap_total_mb, external_mb, array_buffers_mb
 *   cpu_pct           CPU del proceso desde la muestra anterior, en % de UN núcleo
 *   loop_p50_ms, loop_p99_ms, loop_max_ms   retraso del event loop. En Windows
 *                     el temporizador tiene ~15 ms de grano: un proceso en
 *                     reposo marca ~30 ms; lo que importa es lo que pase de ahí
 *   sys_total_mb, sys_free_mb   la máquina vista desde el proceso
 *
 * RUNTIME_METRICS_INTERVAL_SEC: segundos entre muestras (60 por defecto; 0 lo
 * apaga). Va en su propio archivo para que combined.log no lo rote: a 60 s y
 * nueve procesos son ~4 MB al día, y 10 archivos de 10 MB guardan unas tres
 * semanas.
 */

const os = require('os');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');

const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;
const ms = (ns) => Math.round((ns / 1e6) * 10) / 10;

/**
 * deps: { write(record), now(), memoryUsage(), cpuUsage(prev), loop, freemem(), totalmem() }
 * Todo inyectable para las pruebas; en producción, los de Node.
 */
function createRuntimeMetrics(deps = {}) {
  const {
    write,
    now = () => Date.now(),
    memoryUsage = () => process.memoryUsage(),
    cpuUsage = (prev) => process.cpuUsage(prev),
    loop = monitorEventLoopDelay({ resolution: 20 }),
    freemem = os.freemem,
    totalmem = os.totalmem,
  } = deps;

  let lastCpu = cpuUsage();
  let lastAt = now();
  let timer = null;

  function sample() {
    const at = now();
    const cpu = cpuUsage(lastCpu);
    const elapsedUs = Math.max((at - lastAt) * 1000, 1);
    lastCpu = cpuUsage();
    lastAt = at;
    const mem = memoryUsage();
    const record = {
      type: 'runtime_metrics',
      rss_mb: mb(mem.rss),
      heap_used_mb: mb(mem.heapUsed),
      heap_total_mb: mb(mem.heapTotal),
      external_mb: mb(mem.external),
      array_buffers_mb: mb(mem.arrayBuffers || 0),
      cpu_pct: Math.round(((cpu.user + cpu.system) / elapsedUs) * 1000) / 10,
      loop_p50_ms: ms(loop.percentile(50)),
      loop_p99_ms: ms(loop.percentile(99)),
      loop_max_ms: ms(loop.max),
      sys_total_mb: mb(totalmem()),
      sys_free_mb: mb(freemem()),
      uptime_s: Math.round(process.uptime()),
    };
    loop.reset();
    return record;
  }

  return {
    sample,
    start(intervalMs) {
      if (timer || !(intervalMs > 0)) return false;
      loop.enable();
      timer = setInterval(() => write(sample()), intervalMs);
      timer.unref();
      return true;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      loop.disable();
    },
  };
}

let running = null;

/** Arranca el muestreo en este proceso (una vez). Devuelve false si está apagado. */
function startRuntimeMetrics() {
  const seconds = Number(process.env.RUNTIME_METRICS_INTERVAL_SEC ?? 60);
  if (running || !(seconds > 0)) return false;
  const winston = require('winston');
  const { processRole } = require('./logger');
  const file = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    defaultMeta: { host: os.hostname(), pid: process.pid, role: processRole() },
    transports: [
      new winston.transports.File({
        filename: path.join(__dirname, '..', 'logs', 'runtime-metrics.log'),
        maxsize: 10485760, // 10MB
        maxFiles: 10,
      }),
    ],
  });
  running = createRuntimeMetrics({ write: (record) => file.info('runtime metrics', record) });
  return running.start(seconds * 1000);
}

module.exports = { createRuntimeMetrics, startRuntimeMetrics };
