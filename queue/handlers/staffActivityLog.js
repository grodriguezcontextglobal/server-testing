'use strict';

const { describeEntry } = require('../../helpers/auditDescribe');
const { buildDisplay } = require('../../helpers/auditDisplay');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/**
 * Handler de `log:staff-activity`. Es el genérico de dbWrite.js más un paso:
 * normalizar `company_id` a un ObjectId de Mongo antes de insertar.
 *
 * POR QUÉ HACE FALTA: los call-sites de inventario solo tienen el NOMBRE de la
 * compañía — `models/Inventory.js` no guarda ningún id— así que el campo
 * `company_id` del audit trail terminó guardando nombres. El reporte
 * (`createGetStaffActivityLogs`) scopea por id, de modo que esos registros
 * quedaban fuera de su propia compañía.
 *
 * POR QUÉ AQUÍ Y NO EN logStaffActivity: los 12 call-sites hacen
 * `await logStaffActivity(...)` dentro del request. Una traducción que necesita
 * ir a Mongo ahí le agrega latencia a la operación auditada, y con Mongo caído
 * son los 10s del buffering de Mongoose antes de rendirse. En el worker el
 * costo no lo paga el usuario y el job ya trae reintentos y dead-letter.
 *
 * Si la traducción no resuelve, se guarda el valor original en vez de perderlo:
 * un registro bajo el nombre viejo sigue siendo legible (el reporte consulta
 * ambas claves), uno vacío no aparece en ningún lado.
 */
function createStaffActivityLogHandler(
  createFn,
  {
    findCompaniesByName,
    findCompanyNameBySqlId,
    findActorCompanyIds,
    findActor,
    findReceiver,
    findPoolEntry,
    findCompanyName,
  } = {}
) {
  // Cache por proceso. La clave es el nombre: si la compañía se renombra
  // después, el _id al que apunta esa entrada sigue siendo el correcto.
  const idByName = new Map();

  const resolveCompanyId = async (name) => {
    if (idByName.has(name)) return idByName.get(name);

    // Se piden 2: con más de un match el nombre es ambiguo y no se puede
    // atribuir sin adivinar. Un registro de auditoría mal atribuido es peor
    // que uno sin compañía.
    const matches = await findCompaniesByName(name, 2);
    const id = matches?.length === 1 ? String(matches[0]._id) : null;

    if (id) idByName.set(name, id);
    return id;
  };

  const normalize = async (value) => {
    if (!value) return value ?? null;
    if (OBJECT_ID.test(String(value))) return String(value);
    if (!findCompaniesByName) return value;

    return (await resolveCompanyId(value)) || value;
  };

  // Las rutas /api/db_* solo traen el id SQL (header s-company-lq). Se pasa
  // por el NOMBRE, que es lo único que comparten company_info y Company, y de
  // ahí al mismo normalize de arriba. Si falla, company_sql_id queda guardado.
  const companyFromSqlId = async (sqlId) => {
    if (!sqlId || !findCompanyNameBySqlId) return null;
    try {
      const name = await findCompanyNameBySqlId(sqlId);
      if (!name) return null;
      const id = await normalize(name);
      return OBJECT_ID.test(String(id)) ? id : null;
    } catch {
      return null;
    }
  };

  // Último recurso, para las rutas a las que el dashboard no manda ninguna
  // cabecera de compañía (/api/receiver, /api/event, /api/document…): si el
  // autor pertenece a UNA sola compañía, es esa. Con varias no se adivina —un
  // registro mal atribuido es peor que uno sin compañía— y queda en null.
  const companyFromActor = async (uid) => {
    if (!uid || !findActorCompanyIds) return null;
    try {
      const ids = await findActorCompanyIds(uid);
      return ids?.length === 1 ? String(ids[0]) : null;
    } catch {
      return null;
    }
  };

  // Quién era el autor, guardado con el registro (ver models/StaffActivityLog.js § actor).
  const actorSnapshot = async (uid) => {
    if (!uid || !findActor) return undefined;
    try {
      const u = await findActor(uid);
      if (!u) return undefined;
      const name = [u.name, u.lastName].filter(Boolean).join(' ').trim();
      return { ...(name ? { name } : {}), ...(u.email ? { email: u.email } : {}) };
    } catch {
      return undefined;
    }
  };

  // Nombre de la compañía para el desglose ("where"), cacheado por proceso.
  const nameById = new Map();
  const companyNameOf = async (id) => {
    if (!id || !OBJECT_ID.test(String(id)) || !findCompanyName) return undefined;
    if (nameById.has(String(id))) return nameById.get(String(id));
    try {
      const name = (await findCompanyName(String(id))) || undefined;
      nameById.set(String(id), name);
      return name;
    } catch {
      return undefined;
    }
  };

  const handler = async function staffActivityLogHandler(payload) {
    // El log de acceso a datos de alumnos (auditPiiAccess) manda en company_id
    // el id SQL ("137"), no el de Mongo. Sin esto se trataba como un NOMBRE, no
    // resolvía, y el registro quedaba fuera del reporte de su compañía.
    let rawCompany = payload?.company_id;
    let sqlCompany = payload?.company_sql_id;
    if (rawCompany && /^\d+$/.test(String(rawCompany))) {
      sqlCompany = sqlCompany || String(rawCompany);
      rawCompany = null;
    }
    let company_id = await normalize(rawCompany);
    if (!company_id && sqlCompany) {
      company_id = await companyFromSqlId(sqlCompany);
    }
    let details = payload?.details;
    if (!company_id && payload?.source === 'server' && payload?.staff_member_id) {
      company_id = await companyFromActor(payload.staff_member_id);
      if (company_id) details = { ...(details || {}), company_inferred: true };
    }

    const context = await enrichContext({ ...payload, details }, { findReceiver, findPoolEntry });
    const actor = payload?.actor || (await actorSnapshot(payload?.staff_member_id));
    // Una acción sobre OTRA cuenta de staff (force-logout, editar a otro): su
    // email dice sobre quién mejor que el ObjectId.
    let targetLabel = payload?.target_label;
    if (
      !targetLabel &&
      payload?.target_model === 'AdminUser' &&
      payload?.target_id &&
      String(payload.target_id) !== String(payload?.staff_member_id || '')
    ) {
      targetLabel = (await actorSnapshot(payload.target_id))?.email;
    }
    const entry = {
      ...payload,
      details,
      context,
      company_id: company_id ?? null,
      ...(sqlCompany ? { company_sql_id: String(sqlCompany) } : {}),
      ...(targetLabel ? { target_label: targetLabel } : {}),
    };
    const described = describeEntry(entry);

    const final = {
      ...entry,
      ...(described.action ? { action: described.action } : {}),
      ...(described.target_model ? { target_model: described.target_model } : {}),
      ...(actor ? { actor } : {}),
      summary: payload?.summary || described.summary,
      target_label: entry.target_label || described.target_label,
      timestamp: payload?.timestamp || new Date(),
    };
    final.display = buildDisplay(final, {
      companyName: await companyNameOf(final.company_id),
      verb: described.verb,
      object: described.object,
    });

    const doc = await createFn(final);
    return { id: doc.id };
  };
  return handler;
}

const firstString = (v) => (Array.isArray(v) ? v.find((x) => typeof x === 'string' && x) : v);
const serialOf = (device) =>
  typeof device === 'string' ? device : device?.serialNumber || device?.serial_number || undefined;

/**
 * Rutas cuyo request no dice sobre quién ni dónde. receiver-update solo manda
 * `{ id, device }` y la devolución al pool solo `{ id, activity }`: el
 * consumidor, el evento y el serial viven en el documento. Se leen aquí, en el
 * worker, para no cargarle la consulta a la petición. Si falla, se guarda lo
 * que había: un registro con menos contexto es mejor que ninguno.
 */
async function enrichContext(entry, { findReceiver, findPoolEntry }) {
  const ctx = { ...(entry.context || {}) };
  const route = String(entry.details?.route || '');
  try {
    if (/receiver-update\/:id$/.test(route) && entry.target_id && findReceiver) {
      const r = await findReceiver(entry.target_id);
      if (r) {
        ctx.consumer = ctx.consumer || r.user;
        ctx.event_name = ctx.event_name || firstString(r.eventSelected);
        ctx.event_id = ctx.event_id || (r.event_id != null ? String(r.event_id) : undefined);
        const serial = serialOf(r.device);
        if (serial && !(ctx.serial_numbers || []).length) ctx.serial_numbers = [serial];
      }
    } else if (/receivers-pool-update\/:id$/.test(route) && entry.target_id && findPoolEntry) {
      const p = await findPoolEntry(entry.target_id);
      if (p) {
        ctx.event_name = ctx.event_name || firstString(p.eventSelected);
        const serial = serialOf(p.device);
        if (serial && !(ctx.serial_numbers || []).length) ctx.serial_numbers = [serial];
      }
    }
  } catch {
    // contexto incompleto, no registro perdido
  }
  for (const k of Object.keys(ctx)) if (ctx[k] === undefined) delete ctx[k];
  return Object.keys(ctx).length ? ctx : entry.context;
}

module.exports = { createStaffActivityLogHandler, enrichContext };
