'use strict';

/**
 * Handler de la cola para el update masivo de event_item_shipping (ver
 * mysql/controllers/items_events.js § bulkUpdateEventItemShipping y
 * DESIGN_task_queue.md § Fase 4b).
 *
 * Antes corría síncrono dentro del ciclo request/response. Ahora el
 * controller (createQueuedJobController) solo valida y encola; el UPDATE
 * real vive acá dentro de una única transacción con conexión dedicada del
 * pool.
 *
 * resolveEventItemShippingUpdatePlan es pura (sin DB) y la comparten el
 * controller (vía `validate`) y este handler, para no desincronizar
 * ALLOWED_FIELDS entre la validación y la query real.
 */

const ALLOWED_FIELDS = ['shipping_status', 'active', 'notes'];

function resolveEventItemShippingUpdatePlan(body) {
  const { company_id, event_id, updates, filters } = body || {};

  if (!company_id || !event_id) {
    return { error: { status: 400, msg: 'company_id and event_id are required.' } };
  }
  if (!updates || Object.keys(updates).length === 0) {
    return { error: { status: 400, msg: 'At least one update field must be provided.' } };
  }
  if (!filters || Object.keys(filters).length === 0) {
    return { error: { status: 400, msg: 'At least one filter condition must be provided.' } };
  }

  const fieldsToUpdate = Object.keys(updates).filter((field) => ALLOWED_FIELDS.includes(field));
  const filterKeys = Object.keys(filters).filter((field) => ALLOWED_FIELDS.includes(field));

  if (fieldsToUpdate.length === 0) {
    return {
      error: {
        status: 400,
        msg: `No valid fields to update. Allowed fields are: ${ALLOWED_FIELDS.join(', ')}`,
      },
    };
  }
  if (filterKeys.length === 0) {
    return {
      error: {
        status: 400,
        msg: `No valid filter fields provided. Allowed fields are: ${ALLOWED_FIELDS.join(', ')}`,
      },
    };
  }

  return { company_id, event_id, fieldsToUpdate, filterKeys, updates, filters };
}

function buildUpdateQuery(plan) {
  const setClause = plan.fieldsToUpdate.map((field) => `${field} = ?`).join(', ');
  const updateValues = plan.fieldsToUpdate.map((field) => plan.updates[field]);

  const whereConditions = plan.filterKeys.map((key) => `${key} = ?`);
  const filterValues = plan.filterKeys.map((key) => plan.filters[key]);

  return {
    sql: `UPDATE event_item_shipping SET ${setClause} WHERE event_id = ? AND company_id = ? AND ${whereConditions.join(' AND ')}`,
    values: [...updateValues, plan.event_id, plan.company_id, ...filterValues],
  };
}

/**
 * @param {Object} opts
 * @param {Function} opts.getConnection - mysql/database/config.js (devuelve el Pool).
 */
function createEventItemShippingBulkUpdateHandler({ getConnection }) {
  return async function eventItemShippingBulkUpdateHandler(payload) {
    const plan = resolveEventItemShippingUpdatePlan(payload);
    if (plan.error) {
      // No debería pasar en producción -- el controller ya validó antes de
      // encolar -- pero si un job llega inválido se relanza como error real.
      throw new Error(plan.error.msg);
    }

    const pool = getConnection();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const { sql, values } = buildUpdateQuery(plan);
      const [result] = await connection.query(sql, values);

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
  createEventItemShippingBulkUpdateHandler,
  resolveEventItemShippingUpdatePlan,
};
