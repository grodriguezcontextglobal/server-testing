'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Express casa las rutas EN ORDEN DE REGISTRO. Un parámetro sin acotar de un
 * solo segmento —`router.post("/:id")`— captura por tanto cualquier ruta
 * literal registrada después de él, que deja de existir sin dar ningún error:
 * las peticiones acaban en el handler del parámetro.
 *
 * Eso es exactamente lo que pasaba en `mysql/routes/item.js`, donde el borrado
 * de ítems dejaba sin efecto a catorce rutas, `/inventory-query` incluida. Once
 * tenían gemelo vivo en otro prefijo y por eso nadie lo notó en meses.
 *
 * Este test recorre TODOS los routers del repo y falla si vuelve a ocurrir. La
 * forma acotada (`/:id(\\d+)`) no cuenta como captura: solo casa dígitos, así
 * que ninguna ruta con nombre cae en ella.
 */

const ROUTER_DIRS = ['../routes', '../mysql/routes'];

/** Un parámetro SIN acotar de un solo segmento: `/:id`, `/:company_id`. */
const UNBOUNDED_PARAM = /^\/:[A-Za-z0-9_]+$/;
/** Un literal de un solo segmento, que es lo que un parámetro así se traga. */
const SINGLE_LITERAL = /^\/[A-Za-z0-9_-]+$/;

const loadRouters = () => {
  const routers = [];
  for (const dir of ROUTER_DIRS) {
    const full = path.resolve(__dirname, dir);
    for (const file of fs.readdirSync(full)) {
      if (!file.endsWith('.js')) continue;
      const rel = `${dir}/${file}`;
      let router;
      try {
        router = require(path.join(full, file));
      } catch (error) {
        // Un router que no carga es problema de otro test, no de este.
        continue;
      }
      if (router && Array.isArray(router.stack)) routers.push({ rel, router });
    }
  }
  return routers;
};

const findShadowed = ({ rel, router }) => {
  const routes = [];
  router.stack.forEach((layer, index) => {
    if (!layer.route) return;
    Object.keys(layer.route.methods).forEach((method) => {
      routes.push({ index, method, path: layer.route.path });
    });
  });

  const shadowed = [];
  for (const catchAll of routes.filter((r) => UNBOUNDED_PARAM.test(r.path))) {
    for (const route of routes) {
      if (route.method !== catchAll.method) continue;
      if (route.index <= catchAll.index) continue;
      if (!SINGLE_LITERAL.test(route.path)) continue;
      shadowed.push(
        `${rel}: ${route.method.toUpperCase()} ${route.path} lo captura ${catchAll.path}`
      );
    }
  }
  return shadowed;
};

test('ningún router deja rutas sombreadas por un parámetro sin acotar', () => {
  const routers = loadRouters();
  assert.ok(routers.length > 10, `deberían cargarse los routers del repo, fueron ${routers.length}`);

  const shadowed = routers.flatMap(findShadowed);

  assert.deepEqual(
    shadowed,
    [],
    `Rutas inalcanzables (acota el parámetro, p.ej. "/:id(\\\\d+)", o regístralo al final):\n  ${shadowed.join('\n  ')}`
  );
});

test('el borrado de item sigue acotado a dígitos', () => {
  // Es la regresión concreta que motivó el test: si alguien le quita el `(\d+)`,
  // vuelven a morir catorce rutas de golpe.
  const router = require(path.resolve(__dirname, '../mysql/routes/item.js'));
  const layer = router.stack.find((l) => l.route && l.route.path.startsWith('/:id'));

  assert.ok(layer, 'la ruta de borrado por id debe existir');
  assert.equal(layer.route.path, '/:id(\\d+)');
  assert.ok(layer.regexp.test('/200336'), 'debe seguir casando un item_id');
  assert.ok(!layer.regexp.test('/inventory-query'), 'no debe capturar rutas con nombre');
});
