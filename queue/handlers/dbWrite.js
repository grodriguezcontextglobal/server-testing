'use strict';

/**
 * Handler genérico de la cola para escrituras simples a Mongo (logs de evento,
 * notificación, actividad de staff). El payload es el documento a insertar tal
 * cual — no hay lógica de negocio adicional, por eso un solo handler parametrizado
 * por createFn sirve para las 3 colecciones de log (ver queue/handlers/index.js).
 *
 * createFn se inyecta para poder testear sin tocar Mongoose/DB real; en
 * producción se registra con `Model.create.bind(Model)` del modelo correspondiente.
 */
function createModelInsertHandler(createFn) {
  return async function insertHandler(payload) {
    const doc = await createFn(payload);
    return { id: doc.id };
  };
}

module.exports = { createModelInsertHandler };
