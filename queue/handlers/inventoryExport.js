'use strict';

/**
 * Handler del export de inventario (ver mysql/controllers/inventoryExport.js y
 * FRONTEND_inventory_export_contract_2026-09-17.md).
 *
 * Lee el inventario A TROZOS con keyset, escribe el .xlsx con el writer en
 * streaming de exceljs y sube el fichero a S3. El resultado del job lleva una
 * URL prefirmada, su caducidad y el número de filas — el contrato que el
 * frontend necesita para que `BackgroundJobsTracker` descargue al llegar a
 * `done`.
 *
 * NADA DE ESTO SE MATERIALIZA EN MEMORIA: ni las filas (se leen de 1.000 en
 * 1.000) ni el libro (se escribe a un fichero temporal conforme se genera).
 * Traerse el inventario entero a memoria del worker sería mover el problema del
 * navegador al servidor, no resolverlo.
 *
 * Las dependencias se inyectan para poder probar el handler sin MySQL, sin S3 y
 * sin escribir un .xlsx de verdad — igual que `documentUpload.js`.
 */

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { buildInventoryScopeFilter } = require('../../mysql/helpers/staffAccess');
const {
  buildExportChunkQuery,
  buildExportCursor,
  buildEventLookupQuery,
  indexLatestAssignments,
  EXPORT_CHUNK_SIZE,
} = require('../../mysql/queries/inventoryExportQuery');
const {
  SHEET_COLUMNS,
  SHEET_HEADERS,
  SHEET_NAME,
  toSheetRow,
  buildExportFileName,
} = require('../../helpers/inventoryExportSheet');

/**
 * Cuánto dura la URL que se le entrega al usuario.
 *
 * Quince minutos, no los cinco por defecto de `getTemporaryDownloadUrl`: entre
 * que el job termina, el polling de 3s lo detecta y la persona vuelve a la
 * pestaña, cinco minutos se consumen solos. Y el frontend enseña `expiresAt`,
 * así que caducar no sorprende a nadie.
 */
const DOWNLOAD_URL_MINUTES = 15;

/**
 * Techo de filas por export. No es un límite de producto: es el seguro de que
 * un filtro vacío sobre una compañía enorme no deje al worker una hora
 * ocupado. Al pasarse, el job falla con un motivo legible en vez de producir
 * una hoja truncada en silencio — que es el fallo que tiene hoy
 * `items_information` (`item.js:700`).
 */
const MAX_EXPORT_ROWS = 200000;

/**
 * Escritor por defecto: exceljs en modo streaming a fichero.
 *
 * `useStyles` va activado porque la cabecera va en negrita, y `useSharedStrings`
 * DESACTIVADO a propósito: la tabla de cadenas compartidas se guarda entera en
 * memoria hasta cerrar el libro, que es exactamente lo que este handler evita.
 */
const defaultCreateWorkbookWriter = (filePath) => {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: true,
    useSharedStrings: false,
  });
  // `columns` y `views` van en las OPCIONES, no por asignación: en modo
  // streaming la hoja ya se está escribiendo, y `WorksheetWriter.views` es solo
  // de lectura (asignarla revienta con "has only a getter"). Congelar la
  // cabecera importa: una hoja de 50.000 filas sin eso es ilegible al hacer
  // scroll.
  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }],
    columns: SHEET_COLUMNS.map((column) => ({ width: column.width })),
  });

  const header = sheet.addRow(SHEET_HEADERS);
  header.font = { bold: true };
  header.commit();

  return {
    addRow: (values) => sheet.addRow(values).commit(),
    commit: async () => {
      sheet.commit();
      await workbook.commit();
    },
  };
};

function createInventoryExportHandler({
  getConnection,
  uploadExport,
  getDownloadUrl,
  createWorkbookWriter = defaultCreateWorkbookWriter,
  tmpDir = os.tmpdir(),
  now = () => new Date(),
}) {
  return async function inventoryExportHandler(payload, job) {
    const { companyId, access, filters, search, sortBy, sortDir } = payload;

    // El scope se RECONSTRUYE aquí desde el `access` que el controller ya
    // verificó, en vez de viajar como SQL dentro del payload del job: la
    // construcción del filtro se queda en un solo sitio y el documento del job
    // no guarda fragmentos de consulta.
    const scope = buildInventoryScopeFilter(access);

    const connection = getConnection();
    const fileName = payload.fileName || buildExportFileName(companyId, now());
    // El id del job en el nombre temporal: dos exports simultáneos de la misma
    // compañía escribirían sobre el mismo fichero si solo llevara companyId.
    const filePath = path.join(tmpDir, `inventory-export-${job?.id ?? Date.now()}.xlsx`);

    const writer = createWorkbookWriter(filePath);

    const runExport = async () => {
      let cursor = null;
      let rowCount = 0;

      for (;;) {
        const query = buildExportChunkQuery({
          companyId,
          filters,
          search,
          scope,
          sortBy,
          sortDir,
          cursor,
          chunkSize: EXPORT_CHUNK_SIZE,
        });

        const [rows] = await connection.execute(query.sql, query.params);
        if (rows.length === 0) break;

        // `event_name`/`condition` del evento activo, un lote por trozo. Solo
        // para los que NO están en stock: para el resto la hoja ni los mira, y
        // pedirlos sería una consulta por trozo que no cambia ni una celda.
        const outOfStockIds = rows
          .filter((row) => Number(row.warehouse) !== 1)
          .map((row) => row.item_id);
        const lookup = buildEventLookupQuery(outOfStockIds);
        let assignments = new Map();
        if (lookup) {
          const [assignmentRows] = await connection.execute(lookup.sql, lookup.params);
          assignments = indexLatestAssignments(assignmentRows);
        }

        for (const row of rows) {
          const assignment = assignments.get(row.item_id);
          writer.addRow(toSheetRow(assignment ? { ...row, ...assignment } : row));
        }

        rowCount += rows.length;
        if (rowCount > MAX_EXPORT_ROWS) {
          throw new Error(
            `The export exceeds the ${MAX_EXPORT_ROWS.toLocaleString('en-US')} row limit. Narrow the filters and try again.`
          );
        }

        // Un trozo incompleto es el último: no hay que pedir otro para descubrir
        // que está vacío.
        if (rows.length < query.chunkSize) break;
        cursor = buildExportCursor(rows, query.sort);
      }

      await writer.commit();

      // El bucket lo dice QUIEN SUBIÓ, no el entorno: los exports viven en su
      // propio bucket (con borrado al día) y los documentos en el de siempre.
      // Firmar contra el bucket equivocado no lanza -- produce una URL válida
      // hacia donde el fichero no está, y el job terminaría en `done`.
      const { key, bucket } = await uploadExport({ filePath, companyId, fileName });
      const url = await getDownloadUrl(key, DOWNLOAD_URL_MINUTES, { bucket });

      return {
        url,
        expiresAt: new Date(now().getTime() + DOWNLOAD_URL_MINUTES * 60 * 1000).toISOString(),
        rowCount,
        fileName,
      };
    };

    // Si el export revienta ANTES de llegar a la subida, el .xlsx a medio
    // escribir se queda en el temporal del servicio: `uploadInventoryExportToS3`
    // lo borra en su `finally`, pero solo si se llega hasta ahí. El camino que
    // más lo va a provocar es el techo de 200.000 filas, que es justo el error
    // que verá un usuario con un filtro amplio -- o sea, el caso frecuente, no
    // el raro.
    try {
      return await runExport();
    } catch (error) {
      await fs.unlink(filePath).catch(() => {});
      throw error;
    }
  };
}

module.exports = {
  createInventoryExportHandler,
  DOWNLOAD_URL_MINUTES,
  MAX_EXPORT_ROWS,
};
