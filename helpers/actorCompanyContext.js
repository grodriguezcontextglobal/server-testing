'use strict';

const { clientRedis } = require('../database/cacheMemoryConfig');
const logger = require('./logger');

/**
 * Última compañía VERIFICADA con la que trabajó cada usuario, para atribuir
 * las acciones del audit trail que llegan sin cabecera de compañía.
 *
 * El dashboard manda `x-company-id` solo a /api/staff|admin|company|stripe|
 * nodemailer. A /api/receiver, /api/event, /api/document y /api/transaction no
 * le manda nada, así que un usuario de varias compañías dejaba esas acciones
 * con company_id null, y el reporte (que filtra por compañía) no las mostraba.
 *
 * Solo se recuerda una compañía cuando authorizeMongoPermission ya comprobó que
 * el usuario es miembro de ELLA en esa misma petición. Recordar cualquier
 * cabecera permitiría a alguien mandar el id de otra compañía y hacer que sus
 * acciones aparecieran en el reporte de esa compañía.
 *
 * Vive en Redis porque el request que recuerda y el worker que escribe el log
 * pueden ser procesos distintos.
 */

const TTL_SECONDS = 12 * 60 * 60; // una sesión de dashboard
const REWRITE_AFTER_MS = 10 * 60 * 1000; // evita un SET de Redis por petición
const key = (uid) => `audit:company:${uid}`;

function createActorCompanyContext({ getRedis = clientRedis, now = Date.now } = {}) {
  const lastWritten = new Map(); // uid → { companyId, at }, por proceso

  async function remember(uid, companyId) {
    if (!uid || !companyId) return;
    const prev = lastWritten.get(String(uid));
    if (prev && prev.companyId === String(companyId) && now() - prev.at < REWRITE_AFTER_MS) return;
    try {
      const redis = await getRedis();
      await redis.set(key(uid), String(companyId), { EX: TTL_SECONDS });
      lastWritten.set(String(uid), { companyId: String(companyId), at: now() });
    } catch (err) {
      logger.warn('audit: could not remember company context', { err: err?.message });
    }
  }

  async function recall(uid) {
    if (!uid) return null;
    try {
      const redis = await getRedis();
      return (await redis.get(key(uid))) || null;
    } catch {
      return null;
    }
  }

  return { remember, recall };
}

const actorCompanyContext = createActorCompanyContext();

module.exports = { actorCompanyContext, createActorCompanyContext };
