'use strict';

/**
 * POST /api/db_item/inventory-export — el export del inventario, en cola.
 *
 * Contrato async completo (202 + jobId), el mismo que `document:upload-pdf`: el
 * cliente hace polling de `GET /api/jobs/owned/:jobId` y al llegar a `done` lee
 * `result.url` (prefirmada), `result.expiresAt` y `result.rowCount`. Ver
 * FRONTEND_inventory_export_contract_2026-09-17.md §3.
 *
 * POR QUÉ NO ES SÍNCRONO: es el conjunto entero, sin paginar. Generar un .xlsx
 * de 50.000 filas dentro del request deja el event loop del worker bloqueado y
 * se come el timeout de la petición. Lo mismo que ya motivó mover los bulk a la
 * cola.
 *
 * El cuerpo es el de `inventory-page` menos la paginación, y se valida con SUS
 * constructores: un filtro que la página rechaza se rechaza aquí con el mismo
 * 400 y el mismo mensaje. Esa es la garantía de que «lo que exporto» y «lo que
 * veo» no pueden divergir.
 */

const logger = require('../../helpers/logger');
const { enqueue, extractJobContext } = require('../../helpers/queue');
const { resolveAccess } = require('./inventoryPage');
const { buildExportChunkQuery } = require('../queries/inventoryExportQuery');
const { QueryParamError } = require('../queries/inventoryPageQuery');
const { buildExportFileName } = require('../../helpers/inventoryExportSheet');

const JOB_TYPE = 'inventory:export';

function createPostInventoryExport({
  enqueueFn = enqueue,
  extractContextFn = extractJobContext,
  resolveAccessFn = resolveAccess,
} = {}) {
  return async function postInventoryExport(request, response) {
    try {
      const body = request.body || {};
      const resolved = await resolveAccessFn(request, response, body.company_id);
      if (!resolved) return undefined;

      // Validación ADELANTADA: se construye la consulta y se tira. Sin esto, un
      // `sortBy` inválido se descubriría dentro del job, y el usuario recibiría
      // un `failed` treinta segundos después en vez de un 400 inmediato.
      buildExportChunkQuery({
        companyId: resolved.companyId,
        filters: body.filters,
        search: body.search,
        scope: resolved.scope,
        sortBy: body.sortBy,
        sortDir: body.sortDir,
      });

      const context = extractContextFn(request);
      if (!context.uid) {
        // Sin dueño no hay polling posible: `/jobs/owned/:jobId` responde 404 a
        // un job sin `context.uid`, así que el export quedaría inaccesible.
        return response.status(401).json({ ok: false, msg: 'Unauthorized' });
      }
      context.companyId = resolved.companyId;

      // Misma idempotencia que la subida de documentos: un doble clic en
      // "Export" no debe generar dos ficheros ni ocupar el worker dos veces.
      const clientKey =
        typeof request.get === 'function'
          ? request.get('Idempotency-Key') || request.get('idempotency-key')
          : undefined;
      const idempotencyKey = clientKey ? `${JOB_TYPE}:${String(clientKey).trim()}` : undefined;

      const job = await enqueueFn(
        JOB_TYPE,
        {
          companyId: resolved.companyId,
          // El `access` ya verificado viaja con el job: el handler reconstruye
          // con él el scope de rol, sin volver a consultar permisos.
          access: resolved.access,
          filters: body.filters,
          search: body.search,
          sortBy: body.sortBy,
          sortDir: body.sortDir,
          fileName: buildExportFileName(resolved.companyId),
        },
        { context, idempotencyKey }
      );

      return response.status(202).json({
        ok: true,
        msg: 'Inventory export queued',
        jobId: job.id,
      });
    } catch (error) {
      if (error instanceof QueryParamError) {
        return response.status(400).json({ ok: false, msg: error.message });
      }
      logger.error(`postInventoryExport: ${error.message}`);
      return response.status(500).json({ ok: false, msg: error.message });
    }
  };
}

const postInventoryExport = createPostInventoryExport();

module.exports = { postInventoryExport, createPostInventoryExport, JOB_TYPE };
