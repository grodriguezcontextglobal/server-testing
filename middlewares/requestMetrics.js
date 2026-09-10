'use strict';

/**
 * Mide cada petición y la entrega a `helpers/metrics.js`.
 *
 * Se monta ANTES del router, pero mide en `finish`, que es cuando Express ya
 * resolvió qué ruta atendió la petición. Eso es lo que permite agrupar por
 * PLANTILLA (`/api/db_item/:id`) en vez de por ruta con valores dentro
 * (`/api/db_item/200336`), que es la diferencia entre 40 series y 200.000.
 *
 * Coste por petición: un `Date.now()`, un listener de `finish` y unos
 * incrementos sobre un objeto en memoria. Nada de red, nada de disco.
 */

const metrics = require("../helpers/metrics");

/**
 * La plantilla que atendió la petición.
 *
 * `request.route.path` es relativo al router, así que se compone con
 * `baseUrl` para obtener la ruta completa montada. Si nada casó —404, o un
 * middleware que respondió antes de llegar al router— se marca como
 * `__unmatched__` en vez de meter la URL cruda, que es exactamente por donde
 * se cuela la explosión de cardinalidad: un escáner de vulnerabilidades
 * probando 10.000 paths crearía 10.000 series.
 */
const resolveRoute = (request) => {
  const base = request.baseUrl || "";
  const path = request.route && request.route.path ? request.route.path : null;
  if (!path) return `${base || ""}__unmatched__`;
  if (path === "/") return base || "/";
  return `${base}${path}`;
};

/**
 * A qué cliente atribuir la petición.
 *
 * Se prefiere una fuente VERIFICADA (`v:`), que es la que deja
 * `middlewares/notificationAuth.js` tras comprobar la pertenencia del llamante
 * a la compañía. Si no hay, se cae al header `x-company-id` como PISTA (`h:`),
 * marcada como tal.
 *
 * Que la pista sea falsificable no es un problema de seguridad aquí: nadie
 * autoriza nada con este dato, solo colorea un top-N de "quién genera tráfico".
 * Lo peor que consigue un cliente mintiendo es ensuciar su propia fila de una
 * lista de diagnóstico. Se distingue con el prefijo para que nadie saque
 * conclusiones de facturación de una pista.
 */
const resolveTenant = (request) => {
  if (request.verifiedCompanyId) return `v:${request.verifiedCompanyId}`;
  const header = request.header ? request.header("x-company-id") : undefined;
  if (header && typeof header === "string" && header.length <= 64) return `h:${header.trim()}`;
  return undefined;
};

const createRequestMetrics = ({ recordFn = metrics.record } = {}) => (request, response, next) => {
  const startedAt = Date.now();
  let recorded = false;

  const finalize = () => {
    if (recorded) return;
    recorded = true;
    recordFn({
      route: resolveRoute(request),
      method: request.method,
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt,
      tenant: resolveTenant(request),
    });
  };

  // `finish` cubre la respuesta normal; `close` cubre al cliente que corta
  // antes de recibirla. Sin el segundo, una avalancha de peticiones abortadas
  // —que es justo lo que pasa cuando el servidor va lento— sería invisible en
  // las métricas, y es el síntoma que más importa medir.
  response.on("finish", finalize);
  response.on("close", finalize);

  return next();
};

module.exports = {
  createRequestMetrics,
  requestMetrics: createRequestMetrics(),
  resolveRoute,
  resolveTenant,
};
