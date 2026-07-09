'use strict';

/**
 * Handler de la cola para la subida de documentos PDF (ver
 * controller/document.js § uploadDocument y DESIGN_task_queue.md § Fase 2).
 * Un solo job porque la creación del Document depende de la URL que devuelve
 * la subida a S3 — no se pueden separar en dos jobs independientes como se
 * hizo con el correo + log de createErrorFeed.
 *
 * uploadPdfToS3/createDocument se inyectan para testear sin S3/Mongo reales;
 * en producción usan helpers/s3Upload.js y el modelo Document.
 */
function createDocumentUploadHandler({ uploadPdfToS3, createDocument }) {
  return async function documentUploadHandler(payload) {
    const uploadResult = await uploadPdfToS3(payload.file, {
      companyId: payload.company_id,
      companyName: payload.companyName,
      documentType: payload.document_type,
      metadata: {
        trigger_action: payload.trigger_action || undefined,
        ...(payload.tags ? { tags: encodeURIComponent(JSON.stringify(payload.tags)) } : {}),
      },
    });

    const splittingLocation = uploadResult.Location.split(".s3.us-east-2.amazonaws.com/");

    const document = await createDocument({
      company_id: payload.company_id,
      document_url: `${process.env.AWS_S3_BUCKET_NAME}/${splittingLocation[1]}`,
      document_type: payload.document_type,
      trigger_action: payload.trigger_action,
      at_: payload.at_ ? new Date(payload.at_) : undefined,
      title: payload.title,
      description: payload.description,
      language: payload.language,
      requires_signature: payload.requires_signature === "true" || payload.requires_signature === true,
      expiration_date: payload.expiration_date ? new Date(payload.expiration_date) : undefined,
      applicable_locations: payload.applicable_locations,
      applicable_items: payload.applicable_items,
      applicable_events: payload.applicable_events,
      tags: payload.tags,
      metadata: payload.metadata,
      document_config: payload.document_config,
      created_by: payload.created_by,
    });

    return { document };
  };
}

module.exports = { createDocumentUploadHandler };
