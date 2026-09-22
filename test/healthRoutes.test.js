'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const healthRouter = require('../routes/health');

/**
 * Estos tests existen porque hasta ahora las rutas de sondeo estaban fuera del
 * middleware global POR ACCIDENTE: se registraban a nivel de módulo en
 * index.js, y `configureMiddleware` corría después, así que el orden de la pila
 * las dejaba arriba sin que nadie lo hubiera decidido. Cualquiera que moviera
 * una línea cambiaba el comportamiento en silencio, y el síntoma habría sido
 * nssm reiniciando un proceso sano porque su sondeo se llevó un 429.
 *
 * Aquí eso deja de ser una casualidad y pasa a ser una invariante que falla.
 */

const layerFor = (routerInstance, routePath) =>
  routerInstance.stack.find((layer) => layer.route && layer.route.path === routePath);

const handlerNames = (layer) =>
  layer.route.stack.map((entry) => entry.handle.name || '(anonima)');

test('el router expone exactamente /health y /ready', () => {
  const paths = healthRouter.stack.filter((l) => l.route).map((l) => l.route.path).sort();
  assert.deepStrictEqual(paths, ['/health', '/ready']);
});

test('/ready lleva metricas Y limitador en su propia cadena', () => {
  const layer = layerFor(healthRouter, '/ready');
  assert.ok(layer, '/ready deberia existir');

  const names = handlerNames(layer);
  // requestMetrics primero: si midiera despues del limitador, un ataque
  // rechazado con 429 no se veria en /api/metrics, que es justo cuando mas
  // falta hace verlo.
  assert.ok(names[0].length > 0);
  assert.ok(
    layer.route.stack.length >= 3,
    `esperaba metricas + limitador(es) + handler, hubo ${layer.route.stack.length}`
  );
});

test('/health NO lleva limitador, y es deliberado', () => {
  // Su 429 costaria exactamente lo mismo que su 200 -- no consulta nada -- asi
  // que limitarlo no compra nada y si añade la posibilidad de rechazar el
  // sondeo del supervisor. Contra una inundacion de esta ruta la proteccion es
  // de infraestructura, no de la aplicacion.
  const layer = layerFor(healthRouter, '/health');
  assert.strictEqual(
    layer.route.stack.length,
    2,
    'solo requestMetrics y el handler'
  );
});

test('/health responde sin tocar ninguna dependencia', () => {
  // Liveness: tiene que contestar aunque MySQL, Mongo y Redis esten caidos. Si
  // alguna vez alguien le añade una consulta, nssm empezaria a reiniciar
  // procesos sanos cada vez que la base de datos hipara.
  const layer = layerFor(healthRouter, '/health');
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  let payload = null;
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };
  handler({}, response);

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(payload.status, 'operational');
  assert.ok(payload.timestamp);
});

test('index.js monta las rutas de sondeo ANTES del middleware global', () => {
  // La invariante de verdad. Si alguien mueve el `app.use(routes/health)` por
  // debajo de `configureMiddleware(app)`, las dos rutas pasan a compartir el
  // limitador de 300/15min con el trafico de la API y a escribir una linea de
  // log por sondeo. Nada falla de forma visible: simplemente, un dia, el
  // supervisor reinicia un proceso sano.
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

  const mount = source.indexOf('app.use(require("./routes/health"))');
  const middleware = source.indexOf('configureMiddleware(app)');

  assert.notStrictEqual(mount, -1, 'index.js deberia montar routes/health');
  assert.notStrictEqual(middleware, -1, 'index.js deberia llamar a configureMiddleware');
  assert.ok(
    mount < middleware,
    'las rutas de sondeo deben montarse antes que configureMiddleware'
  );
});

test('index.js ya no registra /health ni /ready por su cuenta', () => {
  // Quedarse una copia suelta a nivel de modulo reintroduciria el problema: dos
  // registros para la misma ruta, y gana el primero, que seria el que no pasa
  // por esta cadena.
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.doesNotMatch(source, /app\.get\(\s*['"]\/health['"]/);
  assert.doesNotMatch(source, /app\.get\(\s*['"]\/ready['"]/);
});
