'use strict';

/**
 * Handler genérico de la cola para type='send-email'.
 *
 * El payload ya es el mensaje completamente armado (to/from/subject/html) —
 * la composición del template HTML sigue ocurriendo síncronamente en el
 * controller (ver nodeMailer/queueEmail.js), solo se difiere la LLAMADA DE RED
 * a SendGrid, que es la parte que puede fallar si el proveedor está caído.
 *
 * sendFn se inyecta para poder testear sin tocar SendGrid real; en producción
 * queue/handlers/index.js lo registra con el cliente real de @sendgrid/mail.
 */
function createEmailHandler(sendFn) {
  return async function sendEmailHandler(payload) {
    return sendFn(payload);
  };
}

module.exports = { createEmailHandler };
