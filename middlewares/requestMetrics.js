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

/**
 * Cuenta los bytes de cuerpo que salen hacia el cliente.
 *
 * POR QUÉ NO SE LEE `Content-Length`: `compression()` BORRA esa cabecera cuando
 * comprime (`compression/index.js:225`) y solo comprime a partir de 1 KB. Es
 * decir, la cabecera está exactamente en las respuestas pequeñas y falta en las
 * grandes, que son las que interesa medir. Cualquier ranking de tamaño hecho
 * sobre `Content-Length` —el de `middlewares/requestLogger.js` incluido— sale
 * sesgado justo al revés.
 *
 * Envolver `write`/`end` sí mide lo que el cliente descarga: este middleware se
 * monta ANTES que `compression` (`index.js:80` frente a `index.js:117`), así
 * que cuando compression sustituye esos métodos, los que guarda para escribir
 * de verdad son estos, y por aquí pasan los trozos YA comprimidos.
 *
 * Nunca lanza ni cambia la respuesta: si algo no se puede medir, se devuelve lo
 * contado hasta ese momento.
 */
const instrumentBytes = (response) => {
  let bytes = 0;
  if (!response || typeof response.write !== "function" || typeof response.end !== "function") {
    return () => 0;
  }

  const originalWrite = response.write;
  const originalEnd = response.end;

  const add = (chunk, encoding) => {
    if (!chunk || typeof chunk === "function") return;
    try {
      bytes += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk, typeof encoding === "string" ? encoding : undefined);
    } catch (error) {
      // Un cuerpo no medible (un stream ajeno, un tipo raro) no puede romper
      // la respuesta: se deja de contar y ya está.
    }
  };

  response.write = function (chunk, encoding, callback) {
    add(chunk, encoding);
    return originalWrite.call(this, chunk, encoding, callback);
  };

  response.end = function (chunk, encoding, callback) {
    add(chunk, encoding);
    return originalEnd.call(this, chunk, encoding, callback);
  };

  return () => bytes;
};

const createRequestMetrics = ({ recordFn = metrics.record } = {}) => (request, response, next) => {
  const startedAt = Date.now();
  const readBytes = instrumentBytes(response);
  let recorded = false;

  const finalize = () => {
    if (recorded) return;
    recorded = true;
    recordFn({
      route: resolveRoute(request),
      method: request.method,
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt,
      bytes: readBytes(),
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
  instrumentBytes,
};
