'use strict';

/**
 * Registro y lectura de IDENTIFICADORES ESCANEABLES de un item: el EPC de su
 * etiqueta RFID y/o su código de barras. Ver DESIGN_rfid_event_count.md § 7.
 *
 * Vive en su propio namespace (/api/db_identifier) a propósito, no colgado de
 * /db_item: `mysql/routes/item.js:101` tiene un comodín `router.post("/:id")`
 * que tapa toda ruta POST de un segmento registrada después. Un namespace nuevo
 * evita la trampa en vez de esquivarla.
 *
 * La lógica pura (normalización, reconciliación) vive en
 * mysql/helpers/identifier.js y no sabe nada de HTTP.
 */

const getConnection = require("../database/config");
const logger = require("../../helpers/logger");
const { resolveCompanyContext } = require("../helpers/companyContext");
const { buildInventoryScopeFilter } = require("../helpers/staffAccess");
const { normalizeIdentifier, IDENTIFIER_TYPES } = require("../helpers/identifier");

/** Tope por llamada, alineado al chunk que ya usa el frontend. */
const MAX_BATCH = 500;

const isValidType = (value) => IDENTIFIER_TYPES.includes(String(value || "").trim().toLowerCase());

/**
 * Items de esta compañía, entre los pedidos, que además caen dentro del scope
 * del llamador. Un rol con scope por ubicación/categoría y sin asignaciones
 * matchea nada (`1=0`, fail-closed en buildInventoryScopeFilter), así que la
 * lista vuelve vacía y el registro termina en 404 — no en un 500 ni en una
 * escritura fuera de alcance.
 */
const selectItemsInScope = async (connection, companyId, itemIds, access) => {
  const scope = buildInventoryScopeFilter(access);
  const placeholders = itemIds.map(() => "?").join(", ");
  let sql =
    `SELECT item_id FROM item_inv WHERE company_id = ? AND item_id IN (${placeholders})`;
  const values = [companyId, ...itemIds];
  if (scope.sql) {
    sql += ` AND ${scope.sql}`;
    values.push(...scope.params);
  }
  const [rows] = await connection.execute(sql, values);
  return new Set(rows.map((row) => Number(row.item_id)));
};

/** Filas de item_identifier que ya ocupan alguno de estos valores en la compañía. */
const selectTakenValues = async (connection, companyId, pairs) => {
  if (pairs.length === 0) return [];
  const clause = pairs.map(() => "(id_type = ? AND id_value = ?)").join(" OR ");
  const values = [companyId, ...pairs.flatMap((p) => [p.id_type, p.id_value])];
  const [rows] = await connection.execute(
    `SELECT id, item_id, id_type, id_value, is_active FROM item_identifier
      WHERE company_id = ? AND (${clause})`,
    values
  );
  return rows;
};

const takenKey = (type, value) => `${type}|${value}`;

/**
 * POST /api/db_identifier/register — vincula un identificador a un item.
 *
 * Tres desenlaces posibles cuando el valor ya existe en la compañía:
 *   - lo tiene OTRO item y está activo  -> 409 nombrando ese item_id.
 *   - lo tiene ESTE item y está activo   -> 200, no-op (re-enviar es idempotente).
 *   - existe pero está inactivo          -> se RECLAMA con UPDATE.
 *
 * El último caso no es un detalle: el UNIQUE es (company_id, id_type, id_value)
 * sin `is_active`, así que una fila desactivada sigue ocupando el valor. Un tag
 * que se despega de un equipo y se pega en otro tiene que reclamar la fila, o el
 * INSERT choca contra el UNIQUE.
 */
const registerIdentifier = async (request, response) => {
  const pool = getConnection();
  let connection;
  let transactionStarted = false;

  try {
    const context = await resolveCompanyContext(request);
    if (!context.ok) {
      return response.status(context.status).json({ ok: false, msg: context.msg });
    }

    const { item_id, id_type, id_value } = request.body || {};
    const itemId = Number(item_id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return response.status(400).json({ ok: false, msg: "item_id is required" });
    }
    if (!isValidType(id_type)) {
      return response.status(400).json({
        ok: false,
        msg: `id_type must be one of: ${IDENTIFIER_TYPES.join(", ")}`,
      });
    }
    const type = String(id_type).trim().toLowerCase();
    const value = normalizeIdentifier(id_value);
    if (value === null) {
      return response.status(400).json({ ok: false, msg: "id_value is required" });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const inScope = await selectItemsInScope(connection, context.companyId, [itemId], context.access);
    if (!inScope.has(itemId)) {
      await connection.rollback();
      return response.status(404).json({
        ok: false,
        msg: "Item not found for this company, or outside your assigned scope",
      });
    }

    const taken = await selectTakenValues(connection, context.companyId, [{ id_type: type, id_value: value }]);
    const clash = taken.find((row) => row.id_type === type && row.id_value === value);

    if (clash && Number(clash.is_active) === 1) {
      if (Number(clash.item_id) === itemId) {
        await connection.commit();
        return response.status(200).json({ ok: true, msg: "Identifier already registered for this item" });
      }
      await connection.rollback();
      return response.status(409).json({
        ok: false,
        msg: "Identifier already assigned",
        conflict: { id_value: value, id_type: type, item_id: Number(clash.item_id) },
      });
    }

    // Re-etiquetado: el identificador ANTERIOR de este item, del mismo tipo, se
    // desactiva en vez de borrarse. El historial de qué tag tuvo cada equipo es
    // lo que permite explicar una discrepancia semanas después.
    await connection.execute(
      `UPDATE item_identifier SET is_active = 0
        WHERE company_id = ? AND item_id = ? AND id_type = ? AND is_active = 1`,
      [context.companyId, itemId, type]
    );

    if (clash) {
      await connection.execute(
        `UPDATE item_identifier SET item_id = ?, is_active = 1 WHERE id = ?`,
        [itemId, clash.id]
      );
    } else {
      await connection.execute(
        `INSERT INTO item_identifier (company_id, item_id, id_type, id_value, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [context.companyId, itemId, type, value]
      );
    }

    await connection.commit();
    return response.status(201).json({
      ok: true,
      identifier: { item_id: itemId, id_type: type, id_value: value },
    });
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch (e) {
        logger.error("registerIdentifier rollback failed", { error: e.message });
      }
    }
    logger.error("registerIdentifier failed", { error: error.message });
    return response.status(500).json({ ok: false, msg: error.message });
  } finally {
    if (connection) connection.release();
  }
};

/**
 * POST /api/db_identifier/register-bulk — etiquetado por lote.
 *
 * El pre-flight NO es opcional. El UNIQUE aborta la sentencia entera ante un
 * solo duplicado y el error de MySQL no dice cuál fue, así que sin consultar
 * antes un lote de 300 etiquetas falla completo y sin diagnóstico. Acá se
 * consulta primero, se reportan los conflictos y se aplica el resto.
 */
const registerIdentifiersBulk = async (request, response) => {
  const pool = getConnection();
  let connection;
  let transactionStarted = false;

  try {
    const context = await resolveCompanyContext(request);
    if (!context.ok) {
      return response.status(context.status).json({ ok: false, msg: context.msg });
    }

    const { identifiers } = request.body || {};
    if (!Array.isArray(identifiers) || identifiers.length === 0) {
      return response.status(400).json({ ok: false, msg: "identifiers must be a non-empty array" });
    }
    if (identifiers.length > MAX_BATCH) {
      return response.status(400).json({
        ok: false,
        msg: `Too many identifiers in one call (max ${MAX_BATCH})`,
      });
    }

    const rejected = [];
    const candidates = [];
    for (const entry of identifiers) {
      const itemId = Number(entry?.item_id);
      const type = String(entry?.id_type || "").trim().toLowerCase();
      const value = normalizeIdentifier(entry?.id_value);
      if (!Number.isInteger(itemId) || itemId <= 0 || !isValidType(type) || value === null) {
        rejected.push({ ...entry, reason: "invalid entry" });
        continue;
      }
      candidates.push({ item_id: itemId, id_type: type, id_value: value });
    }
    if (candidates.length === 0) {
      return response.status(400).json({ ok: false, msg: "No valid identifiers in the batch", rejected });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const itemIds = [...new Set(candidates.map((c) => c.item_id))];
    const inScope = await selectItemsInScope(connection, context.companyId, itemIds, context.access);

    const taken = await selectTakenValues(connection, context.companyId, candidates);
    const takenByValue = new Map(
      taken.filter((row) => Number(row.is_active) === 1).map((row) => [takenKey(row.id_type, row.id_value), row])
    );
    const inactiveByValue = new Map(
      taken.filter((row) => Number(row.is_active) !== 1).map((row) => [takenKey(row.id_type, row.id_value), row])
    );

    const conflicts = [];
    const toInsert = [];
    const toClaim = [];
    // Un valor repetido DENTRO del mismo lote es tan ambiguo como uno que ya
    // estaba tomado: el primero gana y el resto se reporta.
    const seenInBatch = new Map();

    for (const candidate of candidates) {
      const key = takenKey(candidate.id_type, candidate.id_value);

      if (!inScope.has(candidate.item_id)) {
        conflicts.push({ ...candidate, reason: "item not found in this company or outside your scope" });
        continue;
      }
      const existing = takenByValue.get(key);
      // `item_id` siempre es EL QUE MANDÓ EL CLIENTE, para que pueda emparejar
      // el conflicto con su propia entrada; el dueño del valor va aparte en
      // `conflict_item_id`. Sobrescribir item_id con el del dueño dejaba al
      // llamador sin saber cuál de sus filas falló.
      if (existing && Number(existing.item_id) !== candidate.item_id) {
        conflicts.push({
          ...candidate,
          reason: "already assigned",
          conflict_item_id: Number(existing.item_id),
        });
        continue;
      }
      if (existing) continue; // ya registrado en este mismo item: no-op
      if (seenInBatch.has(key)) {
        conflicts.push({
          ...candidate,
          reason: "duplicated within the batch",
          conflict_item_id: seenInBatch.get(key),
        });
        continue;
      }
      seenInBatch.set(key, candidate.item_id);

      const inactive = inactiveByValue.get(key);
      if (inactive) toClaim.push({ id: inactive.id, item_id: candidate.item_id });
      else toInsert.push(candidate);
    }

    for (const claim of toClaim) {
      await connection.execute(
        `UPDATE item_identifier SET item_id = ?, is_active = 1 WHERE id = ?`,
        [claim.item_id, claim.id]
      );
    }
    if (toInsert.length > 0) {
      await connection.query(
        `INSERT INTO item_identifier (company_id, item_id, id_type, id_value, is_active) VALUES ?`,
        [toInsert.map((c) => [context.companyId, c.item_id, c.id_type, c.id_value, 1])]
      );
    }

    await connection.commit();
    return response.status(200).json({
      ok: true,
      registered: toClaim.length + toInsert.length,
      conflicts,
      rejected,
    });
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch (e) {
        logger.error("registerIdentifiersBulk rollback failed", { error: e.message });
      }
    }
    logger.error("registerIdentifiersBulk failed", { error: error.message });
    return response.status(500).json({ ok: false, msg: error.message });
  } finally {
    if (connection) connection.release();
  }
};

/** POST /api/db_identifier/by-items — los identificadores activos de N items. */
const getIdentifiersByItems = async (request, response) => {
  try {
    const context = await resolveCompanyContext(request);
    if (!context.ok) {
      return response.status(context.status).json({ ok: false, msg: context.msg });
    }

    const { item_ids } = request.body || {};
    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return response.status(400).json({ ok: false, msg: "item_ids must be a non-empty array" });
    }
    if (item_ids.length > MAX_BATCH) {
      return response.status(400).json({ ok: false, msg: `Too many item_ids in one call (max ${MAX_BATCH})` });
    }

    const ids = [...new Set(item_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length === 0) {
      return response.status(400).json({ ok: false, msg: "item_ids must contain positive integers" });
    }

    const connection = getConnection();
    const placeholders = ids.map(() => "?").join(", ");
    const [rows] = await connection.execute(
      `SELECT item_id, id_type, id_value, is_active, update_at
         FROM item_identifier
        WHERE company_id = ? AND is_active = 1 AND item_id IN (${placeholders})`,
      [context.companyId, ...ids]
    );

    return response.status(200).json({ ok: true, identifiers: rows });
  } catch (error) {
    logger.error("getIdentifiersByItems failed", { error: error.message });
    return response.status(500).json({ ok: false, msg: error.message });
  }
};

module.exports = {
  MAX_BATCH,
  registerIdentifier,
  registerIdentifiersBulk,
  getIdentifiersByItems,
};
