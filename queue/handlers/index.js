'use strict';

/**
 * Registro de handlers de la cola: type -> async (payload, job) => result
 *
 * Los handlers reales se registran en Fase 1 (correos), Fase 2 (Go worker,
 * documentos), etc. Cada uno encapsula la lógica que hoy vive inline en los
 * controllers. El worker (queue/worker.js) resuelve el handler por job.type.
 */

const handlers = new Map();

function register(type, fn) {
  if (typeof fn !== "function") {
    throw new Error(`Handler para '${type}' debe ser una función`);
  }
  handlers.set(type, fn);
}

function getHandler(type) {
  return handlers.get(type) || null;
}

// ─── Registro de handlers de producción ──────────────────────────────────────

const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY_PAID);
const { createEmailHandler } = require("./email");

register("send-email", createEmailHandler((msg) => sgMail.send(msg)));
// Fan-out por personalización (cada destinatario no ve a los demás) — distinto
// de 'send-email' con un array (mensajes DISTINTOS). Mismo handler genérico,
// solo cambia el método de SendGrid al que apunta.
register("send-email-multiple", createEmailHandler((msg) => sgMail.sendMultiple(msg)));

const { createEmailWithS3AttachmentsHandler } = require("./emailWithAttachments");
const { fetchAttachmentAsBase64, deleteDocumentFromS3 } = require("../../helpers/s3Upload");

// Adjuntos grandes: el job solo guarda `attachmentRefs` (keys de S3), nunca el
// base64 (ver returnedItemsToRenterNotification en nodeMailer/notifications.js).
register(
  "send-email-multiple-with-attachments",
  createEmailWithS3AttachmentsHandler((msg) => sgMail.sendMultiple(msg), {
    fetchAttachment: fetchAttachmentAsBase64,
    deleteAttachment: deleteDocumentFromS3,
  })
);

const { createModelInsertHandler } = require("./dbWrite");
const EventLog = require("../../models/EventLog");
const NotificationLog = require("../../models/NotificationLog");
const StaffActivityLog = require("../../models/StaffActivityLog");
const ErrorLogs = require("../../models/ErrorLogs");

register("log:event", createModelInsertHandler((payload) => EventLog.create(payload)));
register("log:notification", createModelInsertHandler((payload) => NotificationLog.create(payload)));
// No usa el genérico: `company_id` puede llegar como NOMBRE de compañía (los
// call-sites de inventario no tienen otro dato) y el reporte scopea por id.
// Ver queue/handlers/staffActivityLog.js.
const { createStaffActivityLogHandler } = require("./staffActivityLog");
const Company = require("../../models/Company");

register(
  "log:staff-activity",
  createStaffActivityLogHandler((payload) => StaffActivityLog.create(payload), {
    findCompaniesByName: (name, limit) =>
      Company.find({ company_name: name }, { _id: 1 }).limit(limit).lean(),
    // Rutas /api/db_*: solo traen el id SQL de la compañía (s-company-lq).
    findCompanyNameBySqlId: async (sqlId) => {
      const getConnection = require("../../mysql/database/config");
      const [[row]] = await getConnection().execute(
        "SELECT company_name FROM company_info WHERE company_id = ? LIMIT 1",
        [String(sqlId)]
      );
      return row?.company_name ?? null;
    },
    // Sin ninguna cabecera de compañía: las compañías activas del autor, con el
    // mismo criterio de membresía que el reporte (findMemberships).
    findActorCompanyIds: async (uid) => {
      const AdminUser = require("../../models/AdminUser");
      const { findMemberships } = require("../../controller/staffActivityLog");
      const user = await AdminUser.findById(uid).select("email").lean();
      if (!user) return [];
      const companies = await findMemberships({ id: uid, email: user.email });
      return companies.map((c) => String(c._id));
    },
  })
);
// payload incluye el _id pre-generado en controller/errorLog.js (para que el
// errorId respondido al cliente coincida con el documento que termina persistido).
register("log:error", createModelInsertHandler((payload) => ErrorLogs.create(payload)));

const { createGoWorkerHandler } = require("./goWorker");
const runGoWorker = require("../../helpers/goWorker");

// Única mutación del Go worker que es fire-and-forget de verdad — el resto
// devuelve conteos/filas afectadas que el cliente usa en la misma respuesta,
// no encajan en la cola sin un cambio de contrato (ver DESIGN_task_queue.md § Fase 2).
register(
  "go-worker:insert-device-event-container",
  createGoWorkerHandler(runGoWorker, "insert-device-event-container")
);

const { createWebhookHandler } = require("./webhook");
// Genérico: cualquier webhook externo disparado por la app (hoy solo el
// disparo de importación de inventario en uploadExcelToS3).
register("webhook:trigger", createWebhookHandler());

const { createDocumentUploadHandler } = require("./documentUpload");
const { uploadPdfToS3 } = require("../../helpers/s3Upload");
const Document = require("../../models/Document");

// Contrato async completo (202+jobId, ver controller/document.js § uploadDocument
// y DESIGN_task_queue.md § Fase 2) — el cliente hace polling a GET /api/jobs/:jobId
// y lee result.document.
register(
  "document:upload-pdf",
  createDocumentUploadHandler({
    uploadPdfToS3,
    createDocument: (fields) => Document.create(fields),
  })
);

const { createInventoryBulkInsertHandler } = require("./inventoryBulkInsert");
const getSqlConnection = require("../../mysql/database/config");

// Hasta ~15,000 seriales por job (ver controller/item.js §
// insertBulkItemAlhpanumericFormat y DESIGN_task_queue.md § Fase 4b). Corre en
// una única transacción con conexión dedicada del pool.
register(
  "inventory:bulk-insert-alphanumeric",
  createInventoryBulkInsertHandler({ getConnection: getSqlConnection })
);

const { createInventoryBulkUpdateAlphanumericHandler } = require("./inventoryBulkUpdateAlphanumeric");

// UPDATE masivo de item_inv por lista de seriales o por criterio (updateAll)
// — ver mysql/controllers/item.js § updateItemsBasedOnAlphanumericSerialNumber.
register(
  "inventory:bulk-update-alphanumeric",
  createInventoryBulkUpdateAlphanumericHandler({ getConnection: getSqlConnection })
);

const { createEventItemShippingBulkUpdateHandler } = require("./eventItemShippingBulkUpdate");

// UPDATE masivo de event_item_shipping — ver
// mysql/controllers/items_events.js § bulkUpdateEventItemShipping.
register(
  "event:bulk-update-item-shipping",
  createEventItemShippingBulkUpdateHandler({ getConnection: getSqlConnection })
);

const { createBulkInsertItemRangeHandler } = require("./bulkInsertItemRange");

// Rango min/max de serial que el SERVIDOR expande a filas -- sin techo
// natural, ver project_bulk_queue_migration_plan.md. El controller
// (mysql/controllers/item.js § insertBulkItem) espera este job con
// waitForJobOutcome y responde igual que antes de migrar si termina rápido.
register(
  "inventory:bulk-insert-range",
  createBulkInsertItemRangeHandler({ getConnection: getSqlConnection })
);

const { createBulkReturnMemberLeasesHandler } = require("./bulkReturnMemberLeases");

// Fin de trimestre: si no se manda member_ids/grade toca TODOS los leases
// pendientes de la compañía -- ver project_bulk_queue_migration_plan.md y
// mysql/controllers/members.js § bulkReturnMemberLeases.
register(
  "member:bulk-return-leases",
  createBulkReturnMemberLeasesHandler({ getConnection: getSqlConnection })
);

const { createDeleteBulkItemBasedOnCriteriaHandler } = require("./deleteBulkItemBasedOnCriteria");

// Sin serial_number, borra TODA una categoría/ubicación del inventario --
// sin techo natural, ver project_bulk_queue_migration_plan.md y
// mysql/controllers/item.js § deleteBulkItemBasedOnCriteria.
register(
  "inventory:bulk-delete-by-criteria",
  createDeleteBulkItemBasedOnCriteriaHandler({ getConnection: getSqlConnection })
);

const { createDeleteBulkItemsByIdsHandler } = require("./deleteBulkItemsByIds");

// Gemela del anterior, por LISTA DE IDS -- el borrado vive en el Go worker
// desde antes de migrar, así que el handler solo mueve la llamada y agrega el
// troceo que faltaba (ver mysql/controllers/item.js § deleteBulkItems).
register(
  "inventory:bulk-delete-by-ids",
  createDeleteBulkItemsByIdsHandler({ runGoWorker })
);

const { createInventoryExportHandler } = require("./inventoryExport");
const {
  uploadInventoryExportToS3,
  getTemporaryDownloadUrl,
} = require("../../helpers/s3Upload");

// Contrato async completo (202 + jobId), como document:upload-pdf: el cliente
// hace polling de GET /api/jobs/owned/:jobId y lee result.url, una URL
// prefirmada al .xlsx. El job lee el inventario a trozos y escribe el libro en
// streaming -- ni las filas ni el fichero se materializan enteros en memoria
// (ver mysql/controllers/inventoryExport.js).
register(
  "inventory:export",
  createInventoryExportHandler({
    getConnection: getSqlConnection,
    uploadExport: uploadInventoryExportToS3,
    getDownloadUrl: getTemporaryDownloadUrl,
  })
);

const { createInventoryImportHandler } = require("./inventoryImportSpreadsheet");
const { processLocation } = require("../../mysql/controllers/location");
const { processSubLocationPath } = require("../../mysql/controllers/sub_location");

// Import de una hoja de calculo entera: UNA fila de item_inv por unidad, con
// los valores de esa unidad. Va aparte de inventory:bulk-insert-alphanumeric
// porque aquel copia los escalares del cuerpo sobre todo el lote -- correcto
// para un grupo de unidades identicas, y la razon por la que un fichero real
// escribia el coste de otra fila en 482 de 500 unidades
// (ver mysql/controllers/inventoryImport.js).
register(
  "inventory:bulk-insert-from-spreadsheet",
  createInventoryImportHandler({
    getConnection: getSqlConnection,
    processLocation,
    processSubLocationPath,
  })
);

const { createBulkInsertMembersHandler } = require("./bulkInsertMembers");

// Import de estudiantes/miembros vía CSV -- un import a nivel de distrito
// puede ser miles de filas, ver project_bulk_queue_migration_plan.md y
// mysql/controllers/members.js § insertBulkMembers.
register(
  "member:bulk-insert",
  createBulkInsertMembersHandler({ getConnection: getSqlConnection })
);

module.exports = { register, getHandler, handlers };
