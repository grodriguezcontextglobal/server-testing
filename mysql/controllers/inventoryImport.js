'use strict';

/**
 * POST /api/db_item/bulk-item-from-spreadsheet — el import de una hoja de
 * cálculo entera, en cola (ver FRONTEND_inventory_import_endpoint_2026-09-21.md).
 *
 * Una fila por unidad, con sus propios valores, en UNA petición. Sustituye al
 * reparto por grupos de `bulk-item-alphanumeric` para el caso de importar un
 * fichero: con aquel, el fichero medido de 500 unidades necesita 499 peticiones
 * contra un límite de 300 cada 15 minutos.
 *
 * Contrato async (202 + jobId) y polling por `GET /api/jobs/owned/:jobId`,
 * igual que el export y que `document:upload-pdf`.
 *
 * LO QUE SE VALIDA AQUÍ Y NO EN EL JOB: la forma del fichero y el permiso. Un
 * fichero con filas sin serial, o una locación fuera del scope del rol, tiene
 * que dar 400/403 al instante y con la fila señalada. Si eso se descubriera
 * dentro del job, el usuario recibiría un `failed` medio minuto después y sin
 * nada accionable. Lo que sí es del job es lo que tarda: crear locaciones,
 * resolver sub-locaciones e insertar.
 */

const logger = require('../../helpers/logger');
const { enqueue, extractJobContext } = require('../../helpers/queue');
const getConnection = require('../database/config');
const { resolveAccess } = require('./inventoryPage');
const { getWritableScope } = require('../helpers/staffAccess');
const {
  validateImportBody,
  distinctLocationNames,
  distinctCategoryNames,
  buildLocationLookupQuery,
  checkImportScope,
  ImportValidationError,
  MAX_IMPORT_UNITS,
} = require('../queries/inventoryImportQuery');

const JOB_TYPE = 'inventory:bulk-insert-from-spreadsheet';

function createPostInventoryImport({
  enqueueFn = enqueue,
  extractContextFn = extractJobContext,
  resolveAccessFn = resolveAccess,
  connectionFn = getConnection,
  getWritableScopeFn = getWritableScope,
} = {}) {
  return async function postInventoryImport(request, response) {
    try {
      const body = request.body || {};
      const resolved = await resolveAccessFn(request, response, body.company_id);
      if (!resolved) return undefined;

      const { units, skipped } = validateImportBody(body);

      const locationNames = distinctLocationNames(units);
      const categoryNames = distinctCategoryNames(units);

      // Una sola consulta para todas las locaciones del fichero. Las que no
      // estén se crean en el job (y se cuentan en su resultado); aquí solo hace
      // falta saber cuáles existen para poder chequear el scope.
      const connection = connectionFn();
      const lookup = buildLocationLookupQuery(resolved.companyId, locationNames);
      const [rows] = await connection.execute(lookup.sql, lookup.params);
      const locationIdsByName = new Map(rows.map((r) => [r.location_name, r.location_id]));

      // Scope de escritura sobre el fichero ENTERO, todo o nada, y nombrando el
      // primer par que sobra para que se pueda arreglar en la hoja.
      const writableScope = await getWritableScopeFn(resolved.access, 'create');
      const scopeCheck = checkImportScope(writableScope, {
        locationIdsByName,
        locationNames,
        categoryNames,
      });
      if (!scopeCheck.ok) {
        return response.status(403).json({ ok: false, msg: scopeCheck.msg });
      }

      const context = extractContextFn(request);
      if (!context.uid) {
        // Sin dueño no hay polling posible: `/jobs/owned/:jobId` responde 404 a
        // un job sin `context.uid`, así que el import quedaría inalcanzable.
        return response.status(401).json({ ok: false, msg: 'Unauthorized' });
      }
      context.companyId = resolved.companyId;

      const clientKey =
        typeof request.get === 'function'
          ? request.get('Idempotency-Key') || request.get('idempotency-key')
          : undefined;
      const idempotencyKey = clientKey ? `${JOB_TYPE}:${String(clientKey).trim()}` : undefined;

      const job = await enqueueFn(
        JOB_TYPE,
        {
          companyId: resolved.companyId,
          company: body.company,
          units,
          defaults: body.defaults || {},
          // Los ids ya resueltos viajan con el job para no repetir la consulta;
          // las que falten las crea el handler.
          locationIds: Object.fromEntries(locationIdsByName),
          // Las filas que el fichero ya trae repetidas se reportan en el
          // resultado del job junto a las demás, para que el cliente tenga UNA
          // sola lista que enseñar.
          skipped,
        },
        { context, idempotencyKey }
      );

      return response.status(202).json({
        ok: true,
        msg: 'Spreadsheet import queued',
        jobId: job.id,
        units: units.length,
        skipped: skipped.length,
      });
    } catch (error) {
      if (error instanceof ImportValidationError) {
        return response.status(400).json({
          ok: false,
          msg: error.message,
          errors: error.errors,
          limit: MAX_IMPORT_UNITS,
        });
      }
      logger.error(`postInventoryImport: ${error.message}`);
      return response.status(500).json({ ok: false, msg: error.message });
    }
  };
}

const postInventoryImport = createPostInventoryImport();

module.exports = { postInventoryImport, createPostInventoryImport, JOB_TYPE };
