'use strict';

/**
 * Lógica del vigilante externo (cloudflare/status-worker).
 *
 * Se prueba desde aquí, con la suite del servidor, porque es la que decide QUÉ
 * VE UN CLIENTE en la página de estado pública. Equivocarse ahí no es un bug
 * interno: es anunciar una caída que no existe, y eso quema la credibilidad de
 * la página — que es lo único que la hace valer como herramienta de venta.
 *
 * El Worker es un módulo ESM, así que se carga con import() dinámico desde este
 * test CommonJS.
 */

const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../cloudflare/status-worker/src/index.js');

/* ---------------------------------------------------------------- *
 * Cómo se traduce una respuesta a estado
 * ---------------------------------------------------------------- */

test('/ready: 503 es caída, degraded es degradado, 200 limpio es operativo', async () => {
  const { CHECKS } = await load();
  const core = CHECKS.find((c) => c.key === 'core_services');

  assert.strictEqual(core.evaluate({ ok: false, status: 503 }, { status: 'unready' }), 'down');
  assert.strictEqual(core.evaluate({ ok: true, status: 200 }, { status: 'degraded' }), 'degraded');
  assert.strictEqual(core.evaluate({ ok: true, status: 200 }, { status: 'ready' }), 'operational');
});

test('/ready sin cuerpo legible no se inventa un degradado', async () => {
  const { CHECKS } = await load();
  const core = CHECKS.find((c) => c.key === 'core_services');

  assert.strictEqual(core.evaluate({ ok: true, status: 200 }, null), 'operational');
});

/* ---------------------------------------------------------------- *
 * El freno al parpadeo — lo que se publica no es el último sondeo
 * ---------------------------------------------------------------- */

test('la primera observación se fija sin avisar', async () => {
  const { nextState } = await load();
  const result = nextState(null, 'operational');

  assert.strictEqual(result.status, 'operational');
  assert.strictEqual(result.first, true, 'un despliegue nuevo no abre con un "recuperado"');
});

test('un fallo suelto NO cambia lo publicado', async () => {
  const { nextState } = await load();
  const previous = { status: 'operational', failures: 0 };

  const result = nextState(previous, 'down');

  assert.strictEqual(result.status, 'operational', 'un tropiezo de red no anuncia una caida');
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.failures, 1);
});

test('dos fallos seguidos sí la publican', async () => {
  const { nextState } = await load();

  const first = nextState({ status: 'operational', failures: 0 }, 'down');
  const second = nextState({ status: first.status, failures: first.failures }, 'down');

  assert.strictEqual(second.status, 'down');
  assert.strictEqual(second.changed, true);
});

test('un sondeo bueno en medio reinicia la cuenta', async () => {
  const { nextState } = await load();

  const failing = nextState({ status: 'operational', failures: 0 }, 'down');
  const recovered = nextState({ status: failing.status, failures: failing.failures }, 'operational');

  assert.strictEqual(recovered.failures, 0);
  assert.strictEqual(recovered.changed, false, 'seguia publicado como operational');

  // Y el siguiente fallo vuelve a empezar de cero, no hereda el de antes.
  const again = nextState({ status: recovered.status, failures: recovered.failures }, 'down');
  assert.strictEqual(again.status, 'operational');
  assert.strictEqual(again.failures, 1);
});

test('salir del verde hacia degraded cuesta lo mismo que hacia down', async () => {
  const { nextState } = await load();

  const once = nextState({ status: 'operational', failures: 0 }, 'degraded');
  assert.strictEqual(once.status, 'operational', 'lo que se frena es abandonar el verde');

  const twice = nextState({ status: once.status, failures: once.failures }, 'degraded');
  assert.strictEqual(twice.status, 'degraded');
  assert.strictEqual(twice.changed, true);
});

test('la recuperación es inmediata: un solo sondeo bueno basta', async () => {
  const { nextState } = await load();

  const result = nextState({ status: 'down', failures: 2 }, 'operational');

  assert.strictEqual(result.status, 'operational');
  assert.strictEqual(result.changed, true, 'anunciar de mas una recuperacion dura un minuto');
});

/* ---------------------------------------------------------------- *
 * La página no puede mentir en verde
 * ---------------------------------------------------------------- */

test('sin ningún dato, el titular NO es "todo operativo"', async () => {
  const { overallOf } = await load();

  const overall = overallOf([{ status: 'unknown' }, { status: 'unknown' }]);

  assert.strictEqual(overall, 'unknown', 'no tener datos no es estar bien');
});

test('un estado viejo se publica como "sin datos", no como lo que decía', async () => {
  const { publishedStatus, STALE_AFTER_MS } = await load();
  const now = Date.parse('2026-09-24T12:00:00.000Z');

  const fresco = { status: 'operational', updated_at: '2026-09-24T11:59:00.000Z' };
  const viejo = { status: 'operational', updated_at: new Date(now - STALE_AFTER_MS - 1000).toISOString() };

  assert.strictEqual(publishedStatus(fresco, now), 'operational');
  assert.strictEqual(
    publishedStatus(viejo, now),
    'unknown',
    'si el cron muere, la pagina no puede seguir diciendo que todo va bien'
  );
});

test('sin fila guardada, o con una fecha ilegible, es "sin datos"', async () => {
  const { publishedStatus } = await load();

  assert.strictEqual(publishedStatus(undefined), 'unknown');
  assert.strictEqual(publishedStatus({ status: 'operational', updated_at: 'nada' }), 'unknown');
});

test('una caída conocida manda sobre un componente sin datos', async () => {
  const { overallOf } = await load();

  assert.strictEqual(overallOf([{ status: 'down' }, { status: 'unknown' }]), 'down');
  assert.strictEqual(overallOf([{ status: 'degraded' }, { status: 'unknown' }]), 'degraded');
  assert.strictEqual(overallOf([{ status: 'operational' }, { status: 'unknown' }]), 'unknown');
  assert.strictEqual(overallOf([{ status: 'operational' }, { status: 'operational' }]), 'operational');
});

test('estando ya caído, un sondeo malo más no vuelve a anunciar nada', async () => {
  const { nextState } = await load();

  const result = nextState({ status: 'down', failures: 0 }, 'down');

  assert.strictEqual(result.changed, false, 'la alerta no se repite cada minuto mientras dure');
});
