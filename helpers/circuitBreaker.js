'use strict';

const DEFAULTS = Object.freeze({
  failureThreshold: 5, // fallos consecutivos para abrir el circuito
  cooldownMs: 30_000,  // tiempo cerrado antes de probar de nuevo (half-open)
});

/**
 * Circuit breaker genérico para envolver una función async que llama a un
 * servicio externo inestable (ej. el Go worker). Estados:
 *   - closed: opera normal, cuenta fallos consecutivos.
 *   - open: tras `failureThreshold` fallos seguidos, las llamadas fallan
 *     RÁPIDO (sin invocar `fn`) durante `cooldownMs` — protege al servicio
 *     caído de más carga y al caller de esperar reintentos condenados a fallar.
 *   - half-open: pasado el cooldown, se permite UN intento real; si tiene
 *     éxito vuelve a closed, si falla reabre el circuito (reinicia el cooldown).
 *
 * `now` se inyecta para tests deterministas (no usa Date.now() internamente).
 *
 * `isFailure(error)` decide qué errores cuentan para abrir el circuito. Por
 * defecto todos cuentan. Se usa para distinguir fallos de INFRAESTRUCTURA (el
 * servicio está caído/erroring → deben abrir el circuito) de errores de
 * NEGOCIO/cliente (ej. tarjeta rechazada en Stripe, o un 4xx): estos últimos
 * son una respuesta EXITOSA del servicio — prueban que está sano —, así que no
 * cuentan y de hecho resetean el contador como un éxito, pero igual se
 * re-lanzan para que el caller responda lo correcto.
 */
function createCircuitBreaker(fn, opts = {}) {
  const { failureThreshold, cooldownMs, now = () => Date.now(), isFailure = () => true } =
    { ...DEFAULTS, ...opts };

  let state = "closed";
  let consecutiveFailures = 0;
  let openedAt = null;

  async function breaker(...args) {
    if (state === "open") {
      if (now() - openedAt < cooldownMs) {
        throw new Error("Circuit breaker is open — failing fast");
      }
      state = "half-open";
    }

    try {
      const result = await fn(...args);
      consecutiveFailures = 0;
      state = "closed";
      return result;
    } catch (error) {
      // Un error que no es de infraestructura significa que el servicio
      // respondió (está sano): resetea el contador y no abre el circuito.
      if (!isFailure(error)) {
        consecutiveFailures = 0;
        state = "closed";
        throw error;
      }

      consecutiveFailures += 1;
      if (state === "half-open" || consecutiveFailures >= failureThreshold) {
        state = "open";
        openedAt = now();
      }
      throw error;
    }
  }

  breaker.getState = () => state;

  return breaker;
}

module.exports = { createCircuitBreaker };
