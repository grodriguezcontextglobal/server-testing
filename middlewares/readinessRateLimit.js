'use strict';

/**
 * Rate limit propio para `GET /ready`.
 *
 * POR QUÉ NO VALE EL LIMITADOR GLOBAL. `/ready` y `/health` se registran a
 * nivel de módulo en index.js, mientras `configureMiddleware` —donde se monta
 * el limitador de 300/15min, helmet y cors— corre después, dentro de
 * `startServer`. En Express el orden de la pila es el orden de registro, así
 * que **esas dos rutas están por encima de todo el middleware global** y hoy no
 * tienen ningún límite.
 *
 * Y ES DELIBERADO QUE SIGAN FUERA DEL GLOBAL: el límite global es por IP y lo
 * comparte con el tráfico de la API. Si algo martillea la API desde la misma
 * IP, el sondeo del balanceador o de nssm se llevaría un 429 y el supervisor
 * concluiría que el proceso está muerto. Un endpoint de salud necesita su
 * propio presupuesto, no compartirlo con quien lo puede agotar.
 *
 * DOS NIVELES, porque el coste de las dos formas de llamarlo no se parece:
 *
 *   - Normal: la respuesta sale de la caché de 2s de `helpers/readiness.js`,
 *     así que mil peticiones cuestan una comprobación. Presupuesto amplio: un
 *     monitor cada 5s son 12/min, y aquí caben varios balanceadores, esta
 *     página abierta en varias pestañas y una persona recargando.
 *   - `?force=1`: **salta la caché y golpea las cuatro dependencias en cada
 *     llamada.** Ese es el vector de amplificación real — una petición de 200
 *     bytes se convierte en cuatro consultas a MySQL, Mongo, Redis y el worker
 *     — y lo introduje yo al añadir el parámetro. Presupuesto estricto.
 *
 * EL STORE ES EN MEMORIA, Y AQUÍ SÍ ES LO CORRECTO. En el resto de la API un
 * store por proceso es un defecto conocido (con cuatro procesos el límite real
 * se multiplica por cuatro). En este endpoint no:
 *
 *   1. Un limitador respaldado por Redis fallaría justo cuando Redis se cae, que
 *      es exactamente cuando hace falta consultar el readiness. Un endpoint de
 *      salud no puede depender de una dependencia que su trabajo es vigilar.
 *   2. Lo que se protege —el event loop de ESTE proceso y su tanda de
 *      comprobaciones— es un recurso por proceso, así que un presupuesto por
 *      proceso es la granularidad correcta, no una aproximación.
 */

const { rateLimit } = require("express-rate-limit");

const WINDOW_MS = Number(process.env.READINESS_RATE_WINDOW_MS || 60_000);
const MAX_TOTAL = Number(process.env.READINESS_RATE_MAX || 120);
const MAX_FORCED = Number(process.env.READINESS_RATE_MAX_FORCED || 6);

/** `?force=1` es lo único que salta la caché del servidor. */
const isForce = (request) => {
  const value = request && request.query ? request.query.force : undefined;
  return value === "1" || value === "true";
};

/**
 * Respuesta al pasarse: cuerpo mínimo y, sobre todo, **sin ejecutar las
 * comprobaciones**. Un 429 que costara lo mismo que un 200 no protegería nada.
 */
const rejected = (scope) => (request, response) =>
  response.status(429).json({
    ready: null,
    status: "rate_limited",
    scope,
    msg:
      scope === "forced"
        ? "Too many forced checks. Drop ?force=1 to read the cached status."
        : "Too many readiness checks.",
  });

const createReadinessLimiter = ({
  windowMs = WINDOW_MS,
  max = MAX_TOTAL,
  maxForced = MAX_FORCED,
} = {}) => {
  const overall = rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rejected("total"),
  });

  const forced = rateLimit({
    windowMs,
    limit: maxForced,
    standardHeaders: false, // no pisar las cabeceras del limitador de arriba
    legacyHeaders: false,
    // Las peticiones normales no gastan de este presupuesto: se sirven de caché.
    skip: (request) => !isForce(request),
    handler: rejected("forced"),
  });

  // Los dos en cadena a propósito: el volumen total queda acotado, y encima el
  // subconjunto caro tiene su propio techo. Alternar force y no-force no sirve
  // para escapar de ninguno de los dos.
  return [overall, forced];
};

module.exports = {
  createReadinessLimiter,
  readinessLimiter: createReadinessLimiter(),
  isForce,
  WINDOW_MS,
  MAX_TOTAL,
  MAX_FORCED,
};
