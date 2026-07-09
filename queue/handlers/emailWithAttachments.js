'use strict';

/**
 * Handler para correos con adjuntos grandes subidos a S3 antes de encolar
 * (ver nodeMailer/notifications.js § returnedItemsToRenterNotification y
 * DESIGN_task_queue.md § Fase 1 — cierre). El job NO carga el base64 del
 * adjunto (riesgo de superar el límite de 16MB por documento de Mongo), solo
 * `attachmentRefs: [{key, filename, type}]`. Este handler:
 *   1. Resuelve cada ref a base64 justo antes de enviar (fetchAttachment).
 *   2. Envía el mensaje (sendFn — normalmente sgMail.sendMultiple).
 *   3. Si el envío tuvo éxito, borra los objetos de S3 (deleteAttachment,
 *      best-effort — un fallo de limpieza no debe tumbar el job).
 * Si el envío falla, los adjuntos NO se borran: deben seguir en S3 para que
 * el reintento pueda volver a resolverlos.
 */
function createEmailWithS3AttachmentsHandler(sendFn, { fetchAttachment, deleteAttachment }) {
  return async function emailWithAttachmentsHandler(payload) {
    const { attachmentRefs, ...msg } = payload;

    if (attachmentRefs && attachmentRefs.length) {
      msg.attachments = await Promise.all(
        attachmentRefs.map(async (ref) => ({
          content: await fetchAttachment(ref.key),
          filename: ref.filename,
          type: ref.type,
          disposition: "attachment",
        }))
      );
    }

    const result = await sendFn(msg);

    if (attachmentRefs && attachmentRefs.length) {
      await Promise.all(
        attachmentRefs.map((ref) => deleteAttachment(ref.key).catch(() => {}))
      );
    }

    return result;
  };
}

module.exports = { createEmailWithS3AttachmentsHandler };
