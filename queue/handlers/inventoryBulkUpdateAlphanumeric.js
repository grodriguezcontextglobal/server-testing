'use strict';

/**
 * Handler de la cola para el update masivo de inventario en formato
 * alfanumérico (ver mysql/controllers/item.js §
 * updateItemsBasedOnAlphanumericSerialNumber y DESIGN_task_queue.md § Fase 4b).
 *
 * Antes corría síncrono dentro del ciclo request/response: un solo UPDATE,
 * pero potencialmente sobre miles de filas (updateAll por criterio de
 * category_name/item_group/brand, o listas grandes de seriales), sosteniendo
 * la conexión HTTP. Ahora el controller (createQueuedJobController) solo
 * valida y encola; el UPDATE real vive acá dentro de una única transacción
 * con conexión dedicada del pool.
 *
 * resolveUpdatePlan es pura (sin DB) y la comparten el controller (vía
 * `validate`, para preservar los 400 existentes antes de encolar) y este
 * handler (para construir el UPDATE real) — una sola fuente de verdad para
 * qué campos/criterios son válidos.
 */

const ALLOWED_REFERENCE_KEYS = ['item_group', 'category_name', 'brand'];
const CONTROL_FIELDS = ['reference', 'updateAll', 'list', 'company_id', 'update_at'];

// Parses the wrapped extra_serial_number format into a per-item Map.
//
// Input format (JSON string or array):
//   [{ "5001": [{ keyObject: "Serial Number", valueObject: "5001" },
//               { keyObject: "item_id",        valueObject: 57105  }] }]
//
// Output: Map { "5001" -> '[{"keyObject":"Serial Number","valueObject":"5001"}]' }
//   -- item_id entries are stripped because they are not stored in the column.
function buildExtraSerialNumberMap(raw) {
  if (raw === undefined || raw === null) return new Map();
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error(`extra_serial_number contains invalid JSON: ${e.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('extra_serial_number must be a JSON array');
  }
  const map = new Map();
  for (const entry of parsed) {
    for (const [serial, data] of Object.entries(entry)) {
      if (Array.isArray(data)) {
        const filtered = data.filter((item) => item?.keyObject !== 'item_id');
        map.set(String(serial), JSON.stringify(filtered));
      }
    }
  }
  return map;
}

/**
 * Resuelve el plan de update desde el body/payload, o devuelve un rechazo
 * `{ error: { status, msg } }` -- mismos mensajes/códigos que el controller
 * síncrono original.
 */
function resolveUpdatePlan(body) {
  const {
    company_id,
    updateAll = false,
    list = [],
    reference = {},
    extra_serial_number,
    ...rawUpdateData
  } = body || {};

  if (!company_id) {
    return { error: { status: 400, msg: 'company_id is required.' } };
  }

  const validUpdateData = {};
  for (const [key, value] of Object.entries(rawUpdateData)) {
    if (!CONTROL_FIELDS.includes(key) && value !== undefined) {
      validUpdateData[key] = value;
    }
  }

  if (updateAll) {
    const referenceEntries = Object.entries(reference).filter(
      ([key, value]) =>
        ALLOWED_REFERENCE_KEYS.includes(key) &&
        value !== undefined &&
        value !== null &&
        String(value).trim() !== '',
    );

    if (referenceEntries.length === 0) {
      return {
        error: {
          status: 400,
          msg: 'reference must include at least one of: item_group, category_name, brand.',
        },
      };
    }

    const baseEntries = Object.entries(validUpdateData);
    if (baseEntries.length === 0) {
      return { error: { status: 400, msg: 'At least one field is required to update.' } };
    }

    return { mode: 'updateAll', company_id, referenceEntries, baseEntries };
  }

  let extraSerialMap;
  try {
    extraSerialMap = buildExtraSerialNumberMap(extra_serial_number);
  } catch (e) {
    return { error: { status: 400, msg: e.message } };
  }

  const effectiveList = Array.isArray(list) && list.length > 0 ? list : [...extraSerialMap.keys()];
  if (effectiveList.length === 0) {
    return {
      error: { status: 400, msg: 'Provide list or extra_serial_number with serial number keys.' },
    };
  }

  const baseEntries = Object.entries(validUpdateData);
  if (baseEntries.length === 0 && extraSerialMap.size === 0) {
    return { error: { status: 400, msg: 'At least one field is required to update.' } };
  }

  return { mode: 'list', company_id, effectiveList, baseEntries, extraSerialMap };
}

function buildUpdateAllQuery(plan) {
  const updateEntries = [...plan.baseEntries, ['update_at', new Date()]];
  const setClause = updateEntries.map(([key]) => `${key} = ?`).join(', ');
  const setValues = updateEntries.map(([, val]) => val);

  const whereClause = [
    'company_id = ?',
    ...plan.referenceEntries.map(([key]) => `${key} = ?`),
  ].join(' AND ');
  const whereValues = [plan.company_id, ...plan.referenceEntries.map(([, val]) => val)];

  return {
    sql: `UPDATE item_inv SET ${setClause} WHERE ${whereClause}`,
    values: [...setValues, ...whereValues],
  };
}

function buildListQuery(plan) {
  const updateEntries = [...plan.baseEntries, ['update_at', new Date()]];
  const setClauses = updateEntries.map(([key]) => `${key} = ?`);
  const setValues = updateEntries.map(([, val]) => val);

  if (plan.extraSerialMap.size > 0) {
    const whenClauses = [];
    for (const serial of plan.effectiveList) {
      const stored = plan.extraSerialMap.get(String(serial));
      if (stored !== undefined) {
        whenClauses.push('WHEN ? THEN ?');
        setValues.push(String(serial), stored);
      }
    }
    if (whenClauses.length > 0) {
      setClauses.push(
        `extra_serial_number = CASE serial_number ${whenClauses.join(' ')} ELSE extra_serial_number END`,
      );
    }
  }

  const placeholders = plan.effectiveList.map(() => '?').join(', ');
  return {
    sql: `UPDATE item_inv SET ${setClauses.join(', ')} WHERE company_id = ? AND serial_number IN (${placeholders})`,
    values: [...setValues, plan.company_id, ...plan.effectiveList],
  };
}

/**
 * @param {Object} opts
 * @param {Function} opts.getConnection - mysql/database/config.js (devuelve el Pool).
 */
function createInventoryBulkUpdateAlphanumericHandler({ getConnection }) {
  return async function inventoryBulkUpdateAlphanumericHandler(payload) {
    const plan = resolveUpdatePlan(payload);
    if (plan.error) {
      // No debería pasar en producción -- el controller ya validó antes de
      // encolar -- pero si un job llega inválido (ej. reintento manual) se
      // relanza como error real en vez de devolver un resultado silencioso.
      throw new Error(plan.error.msg);
    }

    const pool = getConnection();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const { sql, values } = plan.mode === 'updateAll' ? buildUpdateAllQuery(plan) : buildListQuery(plan);
      const [result] = await connection.execute(sql, values);

      await connection.commit();
      return { updated_count: result.affectedRows };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
}

module.exports = {
  createInventoryBulkUpdateAlphanumericHandler,
  resolveUpdatePlan,
  buildExtraSerialNumberMap,
};
