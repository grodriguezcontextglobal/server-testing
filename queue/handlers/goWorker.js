'use strict';

/**
 * Handler genérico de la cola para mutaciones del Go worker que son
 * fire-and-forget (el cliente no necesita el resultado en la misma
 * respuesta). La mayoría de las mutaciones del Go worker NO califican para
 * esto — devuelven conteos/filas afectadas que el cliente usa de inmediato,
 * ver DESIGN_task_queue.md § Fase 2. Este handler sirve para las que sí.
 *
 * runGoWorkerFn se inyecta (en producción, helpers/goWorker.js — que ya trae
 * su propio reintento + circuit breaker) para poder testear sin red real.
 */
function createGoWorkerHandler(runGoWorkerFn, command) {
  return async function goWorkerHandler(payload) {
    return runGoWorkerFn(command, payload);
  };
}

module.exports = { createGoWorkerHandler };
