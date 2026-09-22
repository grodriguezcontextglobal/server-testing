#!/usr/bin/env node
'use strict';

/**
 * Medidor de carga en rampa. Sin dependencias: http/https de Node y nada más.
 *
 * QUÉ BUSCA: la rodilla. No interesa "cuántas peticiones aguanta" como número
 * suelto, sino en qué concurrencia el throughput deja de subir mientras la
 * latencia empieza a dispararse — ahí está el límite real, y todo lo que se
 * mande por encima solo engorda una cola.
 *
 * TRES TRAMPAS QUE HARÍAN QUE LOS NÚMEROS MINTIERAN, y cómo se evitan:
 *
 * 1. EL RATE LIMIT. La API tiene 300 peticiones / 15 min por IP, que son 0,33
 *    por segundo. Un test ingenuo desde una sola IP mide el limitador, no el
 *    servidor, y lo hace a los tres segundos. Por eso los 429 se cuentan
 *    APARTE y el resumen avisa en cuanto aparecen: si los hay, la medición no
 *    vale y hay que subir RATE_LIMIT_MAX en el entorno de pruebas.
 *
 * 2. KEEP-ALIVE. Sin reutilizar conexiones se mide el handshake TCP y, en
 *    Windows, se agotan los puertos efímeros: con ~16.000 puertos y TIME_WAIT
 *    de 4 minutos, el techo artificial es ~66 conexiones nuevas por segundo,
 *    muy por debajo de lo que aguanta el servidor. Se usa un Agent con
 *    keepAlive y maxSockets = concurrencia.
 *
 * 3. CONTAR UN 503 COMO ÉXITO O COMO ERROR, indistintamente. Un 429, un 503 y
 *    un timeout dicen cosas muy distintas — el primero es el limitador, el
 *    segundo es el servidor rindiéndose ordenadamente, y el tercero es que no
 *    llegó a rendirse. Se cuentan en columnas separadas.
 *
 * SEGURIDAD: por defecto solo apunta a localhost. Para cualquier otro destino
 * hay que pasar --allow-remote a conciencia; medir la carga de producción
 * contra clientes reales trabajando no es un test, es un incidente.
 *
 * Uso:
 *   node scripts/loadtest.js --url http://localhost:34001/health
 *   node scripts/loadtest.js --url http://localhost:34001/api/db_item/list \
 *     --stages 1,5,10,25,50 --seconds 10 --header "x-token: eyJ..."
 */

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

// ── Argumentos ───────────────────────────────────────────────────────────────

const parseArgs = (argv) => {
  const args = { headers: [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'allow-remote' || name === 'help') { args[name] = true; continue; }
    const value = argv[++i];
    if (name === 'header') args.headers.push(value);
    else args[name] = value;
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.url) {
  console.log(`
Uso: node scripts/loadtest.js --url <URL> [opciones]

  --url <URL>            Destino. Obligatorio.
  --stages 1,5,10,25     Concurrencias a probar, en orden. Por defecto 1,2,5,10,25,50,100
  --seconds 10           Duración de cada etapa. Por defecto 8
  --method GET           Método HTTP. Por defecto GET
  --body '{"a":1}'       Cuerpo (implica content-type json si no se da otro)
  --header "k: v"        Cabecera. Repetible.
  --timeout 30000        Timeout por petición en ms. Por defecto 30000, como el del servidor
  --allow-remote         Necesario para apuntar fuera de localhost. Léase dos veces.
`);
  process.exit(args.help ? 0 : 1);
}

const target = new URL(args.url);
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(target.hostname);

if (!isLocal && !args['allow-remote']) {
  console.error(`
NEGADO: ${target.hostname} no es localhost.

Este script satura lo que apunta. Contra un servidor con clientes reales
trabajando eso no es un test, es un incidente -- y el rate limit global hara
ademas que midas el limitador y no el servidor.

Si de verdad quieres, repite con --allow-remote.
`);
  process.exit(1);
}

const STAGES = String(args.stages || '1,2,5,10,25,50,100')
  .split(',').map((n) => parseInt(n, 10)).filter((n) => n > 0);
const SECONDS = Number(args.seconds || 8);
const METHOD = (args.method || 'GET').toUpperCase();
const TIMEOUT_MS = Number(args.timeout || 30000);
const BODY = args.body || null;

const headers = {};
for (const raw of args.headers) {
  const index = raw.indexOf(':');
  if (index > 0) headers[raw.slice(0, index).trim()] = raw.slice(index + 1).trim();
}
if (BODY && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
  headers['content-type'] = 'application/json';
}

// ── Percentiles sobre las latencias reales, no sobre cortes ─────────────────

const percentile = (sorted, q) => {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
};

// ── Una etapa ───────────────────────────────────────────────────────────────

const runStage = (concurrency) => new Promise((resolve) => {
  const transport = target.protocol === 'https:' ? https : http;
  // keepAlive obligatorio: ver trampa 2 en la cabecera.
  const agent = new transport.Agent({
    keepAlive: true,
    maxSockets: concurrency,
    maxFreeSockets: concurrency,
  });

  const stats = {
    concurrency,
    latencies: [],
    ok: 0, c4xx: 0, c429: 0, c5xx: 0, c503: 0, timeouts: 0, errors: 0,
    firstError: null,
  };

  const deadline = Date.now() + SECONDS * 1000;
  let inFlight = 0;
  let stopped = false;

  const finish = () => {
    agent.destroy();
    stats.latencies.sort((a, b) => a - b);
    const total = stats.latencies.length + stats.timeouts + stats.errors;
    const elapsed = SECONDS;
    resolve({
      ...stats,
      total,
      rps: Number((total / elapsed).toFixed(1)),
      p50: percentile(stats.latencies, 0.5),
      p95: percentile(stats.latencies, 0.95),
      p99: percentile(stats.latencies, 0.99),
      max: stats.latencies.length ? stats.latencies[stats.latencies.length - 1] : 0,
    });
  };

  const fire = () => {
    if (stopped) {
      if (inFlight === 0) finish();
      return;
    }
    if (Date.now() >= deadline) {
      stopped = true;
      if (inFlight === 0) finish();
      return;
    }

    inFlight += 1;
    const startedAt = process.hrtime.bigint();

    const request = transport.request(
      {
        agent,
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: METHOD,
        headers,
      },
      (response) => {
        // Hay que drenar el cuerpo: dejarlo sin leer mantiene el socket ocupado
        // y falsea la concurrencia real.
        response.resume();
        response.on('end', () => {
          const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
          stats.latencies.push(ms);
          const code = response.statusCode;
          if (code === 429) stats.c429 += 1;
          else if (code === 503) { stats.c503 += 1; stats.c5xx += 1; }
          else if (code >= 500) stats.c5xx += 1;
          else if (code >= 400) stats.c4xx += 1;
          else stats.ok += 1;
          inFlight -= 1;
          fire();
        });
      }
    );

    request.setTimeout(TIMEOUT_MS, () => {
      stats.timeouts += 1;
      request.destroy();
    });

    request.on('error', (error) => {
      // Algunas emisiones llegan con `message` vacio (aborto a nivel de socket),
      // y guardar la cadena vacia dejaba el informe diciendo "sin detalle del
      // error" teniendo el detalle a mano en la siguiente emision.
      const detail = error.message || error.code || String(error);
      if (!stats.firstError && detail) stats.firstError = detail;
      // El destroy del timeout tambien emite error; no contarlo dos veces.
      if (!/socket hang up|aborted/i.test(error.message) || stats.timeouts === 0) {
        stats.errors += 1;
      }
      inFlight -= 1;
      fire();
    });

    if (BODY) request.write(BODY);
    request.end();
  };

  for (let i = 0; i < concurrency; i++) fire();
});

// ── Informe ─────────────────────────────────────────────────────────────────

const pad = (value, width, left = false) => {
  const text = String(value);
  return left ? text.padEnd(width) : text.padStart(width);
};

const main = async () => {
  console.log(`\n${METHOD} ${target.href}`);
  console.log(`etapas: ${STAGES.join(', ')} · ${SECONDS}s cada una · timeout ${TIMEOUT_MS}ms\n`);
  console.log(
    pad('conc', 5), pad('rps', 8), pad('p50', 8), pad('p95', 9), pad('p99', 9),
    pad('max', 9), pad('2xx', 7), pad('4xx', 6), pad('429', 6), pad('5xx', 6),
    pad('t/o', 5), pad('err', 5)
  );
  console.log('-'.repeat(96));

  const results = [];
  for (const concurrency of STAGES) {
    const result = await runStage(concurrency);
    results.push(result);
    console.log(
      pad(result.concurrency, 5), pad(result.rps, 8),
      pad(result.p50.toFixed(0), 8), pad(result.p95.toFixed(0), 9),
      pad(result.p99.toFixed(0), 9), pad(result.max.toFixed(0), 9),
      pad(result.ok, 7), pad(result.c4xx, 6), pad(result.c429, 6),
      pad(result.c5xx, 6), pad(result.timeouts, 5), pad(result.errors, 5)
    );
    // Respiro entre etapas: sin esto, la cola de la anterior contamina la
    // siguiente y la rodilla aparece antes de donde esta.
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log('\n── Lectura ─────────────────────────────────────────────────');

  // Antes que nada: ¿esto mide algo? Un puerto cerrado rechaza conexiones a
  // gran velocidad, y sin este corte el informe anunciaria cientos de "req/s"
  // y una rodilla inventada sobre un servidor que ni siquiera estaba
  // escuchando. Fallar ruidosamente vale mas que un numero bonito y falso.
  const attempted = results.reduce((sum, r) => sum + r.total, 0);
  const failed = results.reduce((sum, r) => sum + r.errors + r.timeouts, 0);
  if (attempted === 0 || failed / attempted > 0.5) {
    const first = results.find((r) => r.firstError);
    console.log(`
  MEDICION INVALIDA: ${failed} de ${attempted} peticiones no obtuvieron respuesta.
  ${first ? 'Primer error: ' + first.firstError : 'Sin detalle del error.'}
  No hay rodilla que reportar; esto no mide el servidor. Comprueba que el destino
  esta escuchando y vuelve a lanzarlo.
`);
    return;
  }

  const limited = results.filter((r) => r.c429 > 0);
  if (limited.length) {
    console.log(
      `\n  AVISO: hubo ${limited.reduce((a, r) => a + r.c429, 0)} respuestas 429. La medicion NO vale:`,
      '\n  estas midiendo el rate limit, no el servidor. Sube RATE_LIMIT_MAX en el entorno',
      '\n  de pruebas y repite.'
    );
  }

  // La rodilla: la ultima etapa en la que el throughput aun crecio de forma
  // apreciable. Pasada esa, mas concurrencia solo añade espera.
  let knee = results[0];
  for (let i = 1; i < results.length; i++) {
    const growth = results[i].rps / Math.max(1, results[i - 1].rps);
    if (growth >= 1.1) knee = results[i];
  }

  const worst = results[results.length - 1];
  console.log(`
  Rodilla alrededor de ${knee.concurrency} peticiones simultaneas: ~${knee.rps} req/s con p95 de ${knee.p95.toFixed(0)}ms.
  En la etapa mas alta (${worst.concurrency}) el throughput fue ${worst.rps} req/s y el p95 ${worst.p95.toFixed(0)}ms.`);

  if (worst.rps <= knee.rps * 1.05 && worst.p95 > knee.p95 * 2) {
    console.log(`
  Patron de saturacion claro: por encima de ${knee.concurrency} el throughput no sube y la latencia
  se multiplica. Todo lo que se mande de mas se queda encolado, no se atiende antes.`);
  }
  if (worst.timeouts > 0) {
    console.log(`
  Hubo ${worst.timeouts} timeouts: a esa carga el servidor ya no termina dentro de ${TIMEOUT_MS}ms.`);
  }
  if (worst.c503 > 0) {
    console.log(`
  Hubo ${worst.c503} respuestas 503: el servidor se esta rindiendo de forma ordenada, que es
  mejor que el timeout -- pero significa que alguna dependencia no da mas.`);
  }
  if (results.some((r) => r.errors > 0)) {
    const first = results.find((r) => r.firstError);
    console.log(`\n  Errores de red. El primero: ${first && first.firstError}`);
  }
  console.log('');
};

main().catch((error) => {
  console.error('loadtest fallo:', error.message);
  process.exit(1);
});
