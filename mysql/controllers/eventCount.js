'use strict';

/**
 * Conteo de cierre de evento por identificador escaneable.
 * Ver DESIGN_rfid_event_count.md § 8.
 *
 * El cliente termina el evento y necesita cerrar el conteo total de
 * dispositivos antes de devolverlos al almacén. El operador barre las cajas con
 * el lector RFID —y escanea con pistola lo que no tiene tag— y esto reconcilia
 * contra lo que el evento tiene asignado.
 *
 * DOS OPERACIONES SEPARADAS, a propósito:
 *   - `reconcile` es SOLO LECTURA y repetible. El operador barre, ve qué falta,
 *     va a buscarlo y barre otra vez.
 *   - `close` es la que escribe.
 * Fusionarlas haría que el segundo barrido intentara devolver equipos que el
 * primero ya devolvió.
 *
 * NO se toca returnEventDevicesToWarehouse (mysql/controllers/item.js): está en
 * producción montado en tres routers. La duplicación de la transacción es deuda
 * aceptada y anotada; converger después, no ahora.
 */

const getConnection = require("../database/config");
const logger = require("../../helpers/logger");
const { resolveCompanyContext } = require("../helpers/companyContext");
const { buildInventoryScopeFilter } = require("../helpers/staffAccess");
const { normalizeIdentifier, reconcile } = require("../helpers/identifier");

/**
 * Tope de identificadores por llamada.
 *
 * 2000, y NO 500 como el resto de los endpoints, por una razón de semántica y no
 * de tamaño: reconciliar no es una operación por valor. `missing` se deriva de
 * ESPERADOS MENOS ESCANEADOS, así que un barrido parcial produce un `missing`
 * parcial — mandar 500 de 1200 valores devuelve los otros 700 marcados como
 * faltantes. Un cliente que trocee y concatene reporta equipos perdidos que
 * están en la caja, y un tope más bajo no lo protege de eso: lo protege del
 * tamaño, no del significado.
 *
 * `scanned` DEBE ser el barrido COMPLETO. Trocear no está soportado.
 *
 * 2000 es holgado para el caso acotado del § 2.4 del diseño (un evento son
 * cientos de dispositivos). Para el conteo de bodega del § 13, que no está
 * acotado, el troceo sí es obligatorio — y ahí la forma correcta es que el job
 * ACUMULE las lecturas del lado del servidor y reconcilie UNA vez al cerrar, no
 * que el cliente fusione respuestas parciales.
 */
const MAX_SCANNED = 2000;

/**
 * Validación PURA del cuerpo, compartida por las dos rutas. Sin I/O, sin
 * `request` — misma forma que `resolveUpdatePlan` y `queue/core.js`. Devuelve
 * `{status, body}` para rechazar, o `null` para seguir.
 *
 * El chequeo de coherencia entre body y header no es paranoia: `authorizePermission`
 * lee el company_id de params/body/query (middlewares/authorizePermission.js:15)
 * mientras `resolveCompanyContext` prefiere el header `s-company-lq`. Si los dos
 * discrepan, el permiso se valida contra una compañía y los datos se leen de
 * otra — no es un hueco (la membresía se reverifica) pero produce 403
 * incomprensibles. Mejor un 400 que lo dice.
 */
const validateCountBody = ({ event_id, company_id, scanned }, verifiedCompanyId) => {
  if (company_id !== undefined && String(company_id) !== String(verifiedCompanyId)) {
    // `detail` nombra los dos valores a propósito. El frontend los toma de dos
    // almacenes distintos con dos momentos de escritura distintos (el header de
    // localStorage, el body de Redux), así que para un usuario multi-compañía
    // pueden divergir de verdad. Sin los dos números en la respuesta, esto
    // parece un bug de permisos y cuesta una tarde de depuración de cada lado.
    // Ninguno de los dos es información nueva: el llamador mandó ambos.
    return {
      status: 400,
      body: {
        ok: false,
        msg: "Company mismatch between header and body",
        detail: { header: verifiedCompanyId, body: company_id },
      },
    };
  }
  if (event_id === undefined || event_id === null || String(event_id).trim() === "") {
    return { status: 400, body: { ok: false, msg: "event_id is required" } };
  }
  if (!Array.isArray(scanned)) {
    return { status: 400, body: { ok: false, msg: "scanned must be an array" } };
  }
  if (scanned.length > MAX_SCANNED) {
    return {
      status: 400,
      body: { ok: false, msg: `Too many identifiers in one call (max ${MAX_SCANNED})` },
    };
  }
  return null;
};

/**
 * Lo que el evento tiene asignado, con el EPC activo de cada item si lo tiene.
 *
 * El JOIN a `item_inv` es OBLIGATORIO y no es por conveniencia:
 * `item_inv_assigned_event` no tiene `company_id` (sus columnas son event_id,
 * item_id, created_at), así que el scope multi-tenant sale de ese JOIN. Sin él
 * la consulta cruza compañías. Está documentado en el catálogo, en
 * `eventAssignments.deleteByEventAndItems` (scopingAdded: true).
 */
const selectExpected = async (connection, companyId, eventId, access) => {
  const scope = buildInventoryScopeFilter(access, {
    locationColumn: "ii.location_id",
    categoryColumn: "ii.category_name",
  });

  let sql =
    `SELECT ii.item_id, ii.serial_number, ii.category_name, ii.item_group,
            idn.id_value AS epc
       FROM item_inv_assigned_event iiae
       JOIN item_inv ii ON ii.item_id = iiae.item_id
       LEFT JOIN item_identifier idn
              ON idn.item_id = ii.item_id AND idn.company_id = ii.company_id
             AND idn.id_type = 'epc' AND idn.is_active = 1
      WHERE iiae.event_id = ? AND ii.company_id = ?`;
  const values = [eventId, companyId];

  if (scope.sql) {
    sql += ` AND ${scope.sql}`;
    values.push(...scope.params);
  }

  const [rows] = await connection.execute(sql, values);
  return rows;
};

/**
 * Clasifica lo escaneado que no era de este evento: `foreign` si el equipo es de
 * esta compañía (típicamente asignado a otro evento, o en bodega) y `unknown` si
 * no aparece en la compañía en absoluto.
 *
 * La distinción vale su consulta: "escaneaste un equipo de otro evento" es
 * accionable en bodega; "no es tuyo" es otra cosa completamente. Se busca en las
 * dos fuentes de identificador —la tabla nueva y el serial legacy de item_inv—
 * en un solo viaje.
 */
const classifyUnmatched = async (connection, companyId, values) => {
  if (values.length === 0) return [];
  const placeholders = values.map(() => "?").join(", ");
  const [rows] = await connection.execute(
    `SELECT id_value AS value, item_id FROM item_identifier
      WHERE company_id = ? AND is_active = 1 AND id_value IN (${placeholders})
     UNION
     SELECT serial_number AS value, item_id FROM item_inv
      WHERE company_id = ? AND serial_number IN (${placeholders})`,
    [companyId, ...values, companyId, ...values]
  );
  return rows;
};

/** Arma la respuesta común a las dos rutas desde el resultado de reconcile(). */
const buildReport = (result, foreignRows, scannedValues) => {
  const foreignByValue = new Map(
    foreignRows.map((row) => [normalizeIdentifier(row.value), Number(row.item_id)])
  );

  const foreign = [];
  const unknown = [];
  for (const value of result.unmatched) {
    if (foreignByValue.has(value)) {
      foreign.push({ id_value: value, item_id: foreignByValue.get(value) });
    } else {
      unknown.push(value);
    }
  }

  return {
    summary: {
      expected: result.matched.length + result.missingTagged.length + result.missingUntagged.length,
      scanned: scannedValues.length,
      matched: result.matched.length,
      missing: result.missingTagged.length + result.missingUntagged.length,
      foreign: foreign.length,
      unknown: unknown.length,
      ambiguous: result.ambiguous.length,
    },
    matched: result.matched,
    missing_tagged: result.missingTagged,
    missing_untagged: result.missingUntagged,
    foreign,
    unknown,
    ambiguous: result.ambiguous,
  };
};

/** Normaliza y deduplica el barrido antes de comparar. */
const normalizeScanned = (scanned) => {
  const seen = new Set();
  for (const raw of scanned) {
    const value = normalizeIdentifier(raw);
    if (value !== null) seen.add(value);
  }
  return [...seen];
};

/**
 * POST /api/db_events/event-count/reconcile — solo lectura, repetible.
 *
 * Es el momento que importa: "48 de 50, faltan el #12 y el #37", en pantalla,
 * antes de que el camión salga.
 */
const reconcileEventCount = async (request, response) => {
  try {
    const { event_id, company_id, scanned } = request.body || {};

    const context = await resolveCompanyContext(request);
    if (!context.ok) {
      return response.status(context.status).json({ ok: false, msg: context.msg });
    }
    const rejection = validateCountBody({ event_id, company_id, scanned }, context.companyId);
    if (rejection) return response.status(rejection.status).json(rejection.body);

    const connection = getConnection();
    const expected = await selectExpected(connection, context.companyId, event_id, context.access);
    const values = normalizeScanned(scanned);

    const result = reconcile({ expected, scanned: values });
    const foreignRows = await classifyUnmatched(connection, context.companyId, result.unmatched);

    return response.status(200).json({ ok: true, ...buildReport(result, foreignRows, values) });
  } catch (error) {
    logger.error("reconcileEventCount failed", { error: error.message });
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

/**
 * POST /api/db_events/event-count/close — devuelve a bodega lo que apareció.
 *
 * CIERRE PARCIAL a propósito: con 2 faltantes de 50 se cierran los 48 y los 2
 * quedan asignados al evento, reportados. Bloquear el cierre entero por dos
 * equipos obligaría al operador a elegir entre mentir y no cerrar.
 *
 * No hace falta `item_group` ni `category_name` —a diferencia de
 * returnEventDevicesToWarehouse, que los exige para desambiguar un serial—
 * porque el identificador ya es inequívoco. Eso habilita el caso que hoy no se
 * puede atender: un pelican mixto barrido de una pasada.
 */
const closeEventCount = async (request, response) => {
  const pool = getConnection();
  let connection;
  let transactionStarted = false;

  try {
    const { event_id, company_id, scanned } = request.body || {};

    const context = await resolveCompanyContext(request);
    if (!context.ok) {
      return response.status(context.status).json({ ok: false, msg: context.msg });
    }
    const rejection = validateCountBody({ event_id, company_id, scanned }, context.companyId);
    if (rejection) return response.status(rejection.status).json(rejection.body);

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const expected = await selectExpected(connection, context.companyId, event_id, context.access);
    const values = normalizeScanned(scanned);
    const result = reconcile({ expected, scanned: values });

    const itemIds = result.matched.map((row) => Number(row.item_id));
    let returnedItems = 0;
    let removedAssignments = 0;

    if (itemIds.length > 0) {
      const placeholders = itemIds.map(() => "?").join(", ");

      // Bloquear antes de escribir, igual que returnEventDevicesToWarehouse: dos
      // operadores cerrando el mismo evento a la vez no deben pisarse.
      await connection.execute(
        `SELECT item_id FROM item_inv
          WHERE company_id = ? AND item_id IN (${placeholders}) FOR UPDATE`,
        [context.companyId, ...itemIds]
      );

      const [updated] = await connection.execute(
        `UPDATE item_inv SET warehouse = 1, update_at = NOW()
          WHERE company_id = ? AND item_id IN (${placeholders})`,
        [context.companyId, ...itemIds]
      );
      returnedItems = updated.affectedRows || 0;

      const [deleted] = await connection.execute(
        `DELETE FROM item_inv_assigned_event
          WHERE event_id = ? AND item_id IN (${placeholders})`,
        [event_id, ...itemIds]
      );
      removedAssignments = deleted.affectedRows || 0;
    }

    const foreignRows = await classifyUnmatched(connection, context.companyId, result.unmatched);

    await connection.commit();

    return response.status(200).json({
      ok: true,
      returned_items: returnedItems,
      removed_assignments: removedAssignments,
      ...buildReport(result, foreignRows, values),
    });
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch (e) {
        logger.error("closeEventCount rollback failed", { error: e.message });
      }
    }
    logger.error("closeEventCount failed", { error: error.message });
    return response.status(500).json({ ok: false, msg: error.message });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = {
  MAX_SCANNED,
  reconcileEventCount,
  closeEventCount,
};
