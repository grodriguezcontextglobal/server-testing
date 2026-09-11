'use strict';

/**
 * Las dos rutas de sondeo, con su cadena propia.
 *
 * ESTÁN FUERA DEL MIDDLEWARE GLOBAL A PROPÓSITO. Antes lo estaban por
 * accidente —se registraban a nivel de módulo en `index.js`, y
 * `configureMiddleware` corría después, así que el orden de la pila las dejaba
 * arriba sin que nadie lo hubiera decidido—. Ahora se montan explícitamente
 * antes, y este comentario es la decisión:
 *
 *   - **Limitador global (300/15min por IP): no.** Compartirían presupuesto con
 *     el tráfico de la API, y el sondeo que decide si el proceso sigue vivo no
 *     puede quedarse sin cuota por culpa de tráfico ajeno. Si nssm o el
 *     balanceador reciben un 429, concluyen que el proceso está muerto y
 *     reinician uno que estaba perfectamente sano. `/ready` lleva su propio
 *     presupuesto en `middlewares/readinessRateLimit.js`.
 *   - **`requestLogger`: no.** No excluye rutas, así que cada sondeo escribiría
 *     una línea. Un health check cada 5s son ~17.000 líneas al día de ruido, en
 *     unos logs que ya tuvimos que acotar.
 *   - **`compression` y `cors`: no aportan.** Comprimir 1 KB de JSON cuesta CPU
 *     y no ahorra nada, y la página que lo consume es del mismo origen.
 *   - **`requestMetrics`: sí**, enganchado aquí a cada ruta. De lo contrario
 *     serían las dos únicas invisibles en `/api/metrics`, y un ataque contra
 *     `/ready` es precisamente lo que hay que poder ver ahí.
 *
 * `test/healthRoutes.test.js` fija esto como invariante: si alguien mueve el
 * montaje detrás del middleware global, el test falla en vez de que lo
 * descubramos porque nssm reinició un proceso sano.
 */

const { Router } = require("express");

const { requestMetrics } = require("../middlewares/requestMetrics");
const { readinessLimiter } = require("../middlewares/readinessRateLimit");
const { getReadiness } = require("../helpers/readiness");
const logger = require("../helpers/logger");

const router = Router();

/**
 * LIVENESS. Deliberadamente plano y sin dependencias: responde mientras el
 * proceso pueda atender un socket. Es lo que nssm y el HEALTHCHECK del
 * contenedor deben mirar para decidir *reiniciar o no*.
 *
 * SIN LIMITADOR, tambien a proposito: su 429 costaria exactamente lo mismo que
 * su 200 —no consulta nada—, asi que un limite no compra nada y si añade la
 * posibilidad de rechazar el sondeo del supervisor. Contra una inundacion de
 * esta ruta la proteccion es de infraestructura (IIS, el balanceador), no de la
 * aplicacion.
 */
router.get("/health", requestMetrics, (request, response) => {
  response.status(200).json({
    server: "standby",
    status: "operational",
    timestamp: new Date().toISOString(),
  });
});

/**
 * READINESS. Comprueba MySQL, Mongo, Redis y el worker de Go, y devuelve 503 si
 * falla una CRITICA (MySQL o Mongo) para que un balanceador saque este proceso
 * de rotacion en vez de seguir mandandole peticiones que van a dar 500. Redis y
 * el worker degradan, no descalifican.
 *
 * SI lleva limitador: `?force=1` salta la cache de 2s y golpea las cuatro
 * dependencias en cada llamada, que es el vector de amplificacion real.
 */
router.get("/ready", requestMetrics, readinessLimiter, async (request, response) => {
  try {
    const readiness = await getReadiness({ force: request.query.force === "1" });
    return response.status(readiness.ready ? 200 : 503).json(readiness);
  } catch (error) {
    logger.error("readiness check threw", { error: error.message });
    return response
      .status(503)
      .json({ ready: false, status: "unready", error: error.message });
  }
});

module.exports = router;
