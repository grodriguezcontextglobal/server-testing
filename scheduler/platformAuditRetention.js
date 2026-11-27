'use strict';

/**
 * Retencion de `platform_audit_log` (DC2; AU-11).
 *
 * LA REGLA ACORDADA: las filas de un cliente se guardan mientras el cliente
 * esta activo, mas 120 dias.
 *
 * DESDE CUANDO SE CUENTAN ESOS 120 DIAS. Desde el 2026-11-27 hay dos casos, y
 * el primero es el bueno:
 *
 *   A. La compañia tiene `offboardedAt` (models/Company.js, APP-2026-016): se
 *      cuenta desde esa fecha. Es el dia real de la baja, dicho por quien la
 *      dio, y no depende de que este job pase ni de cuando pase.
 *
 *   B. No lo tiene. Entonces lo unico observable sigue siendo que la compañia
 *      ya NO ESTA en Mongo, que es como funcionaba esto entero hasta hoy:
 *
 *        1. Compañia presente            -> no se borra nada suyo, nunca.
 *        2. Ausente por primera vez      -> se anota el dia en `platform_audit_retention`.
 *        3. Ausente desde hace >= 120 d  -> se borran TODAS sus filas.
 *        4. Reaparece                    -> se borra su anotacion; el contador a cero.
 *
 * El caso B retiene de mas, nunca de menos, porque el contador arranca al
 * detectar la ausencia y no antes. Sigue ahi para las compañias borradas a pelo
 * de Mongo, que no dejan ningun `offboardedAt` detras. Cuando una compañia que
 * estaba anotada en el caso B recibe su fecha, la anotacion se retira: manda la
 * fecha declarada.
 *
 * Una compañia DADA DE BAJA SIGUE EXISTIENDO en Mongo. Por eso "presente" aqui
 * no significa "existe" sino "existe y no tiene fecha de baja": si se tratara
 * como presente por el mero hecho de existir, su log no caducaria nunca.
 *
 * Contar desde la fecha de cada fila en vez de desde la baja seria incorrecto en
 * el sentido peligroso: a un cliente dado de baja ayer se le borraria hoy mismo
 * todo lo anterior a hace 120 dias, que es exactamente la evidencia que la regla
 * quiere conservar.
 *
 * FILAS SIN COMPAÑIA (`company_id IS NULL`) — las busquedas que cruzan clientes,
 * `/me` y los `signin` — se anclan al OPERADOR en vez de a la compañia: cuenta
 * activa, mas 120 dias. Es la respuesta del dashboard a O3 (2026-11-19) y tiene
 * a proposito la MISMA forma que la regla de cliente, con otro sujeto, para que
 * la retencion de la tabla entera se explique en una sola frase:
 *
 *   5. Operador activo               -> no se borra nada suyo, nunca.
 *   6. Inactivo o borrado, visto
 *      por primera vez               -> se anota en `platform_audit_actor_retention`.
 *   7. Asi desde hace >= 120 d       -> se borran sus filas SIN COMPAÑIA.
 *   8. Vuelve a estar activo         -> se borra su anotacion; el contador a cero.
 *
 * Con el mismo reparto A/B: una cuenta desactivada que tenga `deactivatedAt`
 * —las que desactiva scheduler/staffInactivity.js lo tienen— cuenta desde esa
 * fecha, y solo las que no lo tengan pasan por la anotacion observada.
 *
 * Las filas CON compañia de ese mismo operador no las toca este paso: sobre los
 * datos de un cliente manda la regla del cliente.
 *
 * FILAS SIN COMPAÑIA Y SIN OPERADOR no tienen ancla posible: no se borran y el
 * job las cuenta aparte en cada vuelta. Hoy deberian ser cero — el gate no
 * escribe fila para una peticion sin sesion, justamente para que un anonimo no
 * pueda llenar la tabla—, asi que si el contador sube es que hay algo que mirar.
 *
 * PLATFORM_AUDIT_RETENTION_MODE (lazy, como el resto de modos):
 *   warn (por defecto)  calcula y registra lo que borraria; NO BORRA.
 *   enforce             borra.
 *   off                 no hace nada.
 * PLATFORM_AUDIT_RETENTION_DAYS   120 por defecto.
 *
 * El defecto es `warn` a proposito y no por prudencia generica: esto borra
 * evidencia de auditoria. Pasa a `enforce` cuando una vuelta en warn enseñe una
 * cuenta que cuadre.
 *
 * Corre a diario desde scheduler/index.js (03:40, hora del servidor), despues
 * del barrido de cuentas inactivas.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const retentionMode = (env = process.env) => {
  const raw = String(env.PLATFORM_AUDIT_RETENTION_MODE || 'warn').toLowerCase();
  return ['warn', 'enforce', 'off'].includes(raw) ? raw : 'warn';
};

const retentionDays = (env = process.env) => {
  const raw = Number.parseInt(env.PLATFORM_AUDIT_RETENTION_DAYS, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 120;
};

/**
 * Decide que hacer, sin tocar ninguna base. Separado para poder probar la regla
 * —que es la parte delicada— sin MySQL ni Mongo.
 *
 * @param {string[]} subjectsInLog    ids presentes en el log
 * @param {Set<string>} present       ids VIGENTES (existen y sin fecha de baja)
 * @param {Map<string, Date>} absentSince ids ya anotados como ausentes, y desde cuando
 * @param {Map<string, Date>} [knownSince] fecha de baja DECLARADA; manda sobre la anotada
 * @param {Date} now
 * @param {number} days
 * @returns {{mark: string[], clear: string[], purge: {subjectId: string, absentSince: Date, days: number, declared: boolean}[]}}
 */
const planSubjectRetention = ({ subjectsInLog, present, absentSince, knownSince, now, days }) => {
  const declaredSince = knownSince || new Map();
  const mark = [];
  const clear = [];
  const purge = [];

  for (const subjectId of subjectsInLog) {
    if (present.has(subjectId)) {
      // Sigue vigente: no se borra nada suyo. Y si estaba anotado como ausente
      // (volvio, o hubo un fallo de lectura en una vuelta anterior), se le quita
      // la anotacion para que el contador no siga corriendo.
      if (absentSince.has(subjectId)) clear.push(subjectId);
      continue;
    }

    // La fecha declarada manda sobre la observada, y la deja sin uso.
    const declared = declaredSince.get(subjectId) || null;
    const since = declared || absentSince.get(subjectId);
    if (!since) {
      mark.push(subjectId);
      continue;
    }

    const elapsedDays = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
    if (elapsedDays >= days) {
      purge.push({ subjectId, absentSince: since, days: elapsedDays, declared: Boolean(declared) });
      continue;
    }

    // Con fecha declarada, la anotacion observada ya no pinta nada: estorba y
    // ademas diria otra cosa. El purgado de arriba la borra por su cuenta.
    if (declared && absentSince.has(subjectId)) clear.push(subjectId);
  }

  return { mark, clear, purge };
};

const planRetention = ({ companiesInLog, presentCompanies, absentSince, offboardedAt, now, days }) => {
  const plan = planSubjectRetention({
    subjectsInLog: companiesInLog, present: presentCompanies, absentSince,
    knownSince: offboardedAt, now, days,
  });
  return {
    ...plan,
    purge: plan.purge.map(({ subjectId, ...rest }) => ({ companyId: subjectId, ...rest })),
  };
};

/**
 * La misma regla con el OPERADOR como ancla, para las filas sin compañia (O3).
 * `activeOperators` son los ids de cuenta que siguen existiendo Y activas: una
 * cuenta desactivada cuenta como ausente, porque a diferencia de una compañia si
 * tenemos la bandera y seria absurdo no usarla.
 */
const planActorRetention = ({ actorsInLog, activeOperators, absentSince, deactivatedAt, now, days }) => {
  const plan = planSubjectRetention({
    subjectsInLog: actorsInLog, present: activeOperators, absentSince,
    knownSince: deactivatedAt, now, days,
  });
  return {
    ...plan,
    purge: plan.purge.map(({ subjectId, ...rest }) => ({ actorUserId: subjectId, ...rest })),
  };
};

const utcStamp = (date) => date.toISOString().replace('T', ' ').replace('Z', '');

/**
 * @param {object} [deps] Todo inyectable: los tests no tienen ni MySQL ni Mongo.
 */
const runPlatformAuditRetention = async ({
  env = process.env,
  now = new Date(),
  getConnectionFn,
  listExistingCompanies,
  listActiveOperators,
  logger: log,
} = {}) => {
  const mode = retentionMode(env);
  const days = retentionDays(env);
  const logging = log || require('../helpers/logger');

  if (mode === 'off') {
    return {
      mode, days, scanned: 0, marked: 0, cleared: 0, purgedCompanies: 0, deletedRows: 0,
      orphanRows: 0, orphanActors: 0, purgedActors: 0, deletedOrphanRows: 0, unanchorableRows: 0,
    };
  }

  const getConn = getConnectionFn || require('../mysql/database/config');
  const connection = getConn();

  const [logCompanies] = await connection.execute(
    'SELECT DISTINCT company_id FROM platform_audit_log WHERE company_id IS NOT NULL'
  );
  const companiesInLog = logCompanies.map((row) => String(row.company_id));

  const [[orphan]] = await connection.execute(
    'SELECT COUNT(*) AS n FROM platform_audit_log WHERE company_id IS NULL'
  );
  const orphanRows = Number(orphan?.n || 0);

  // O3: las filas sin compañia se anclan al operador que las produjo.
  const [logActors] = await connection.execute(
    'SELECT DISTINCT actor_user_id FROM platform_audit_log WHERE company_id IS NULL AND actor_user_id IS NOT NULL'
  );
  const actorsInLog = logActors.map((row) => String(row.actor_user_id));

  // Sin compañia Y sin operador: no hay ancla. Se cuentan y se dicen; no se
  // borran. Hoy deberia ser cero.
  const [[unanchorable]] = await connection.execute(
    'SELECT COUNT(*) AS n FROM platform_audit_log WHERE company_id IS NULL AND actor_user_id IS NULL'
  );
  const unanchorableRows = Number(unanchorable?.n || 0);

  const [absentRows] = await connection.execute(
    'SELECT company_id, first_absent_at FROM platform_audit_retention'
  );
  const absentSince = new Map(
    absentRows.map((row) => [String(row.company_id), new Date(row.first_absent_at)])
  );

  const lookup = listExistingCompanies || (async (ids) => {
    const { Types } = require('mongoose');
    const Company = require('../models/Company');
    // Un id que ni siquiera es un ObjectId no puede existir en Mongo: se trata
    // como ausente en vez de reventar la consulta entera.
    const valid = ids.filter((id) => Types.ObjectId.isValid(id));
    if (!valid.length) return [];
    const found = await Company.find({ _id: { $in: valid } }).select('_id offboardedAt').lean();
    return found.map((doc) => ({ id: String(doc._id), offboardedAt: doc.offboardedAt || null }));
  });

  // El inyectable puede devolver ids a secas —lo que devolvia hasta el
  // 2026-11-27, y lo que siguen devolviendo los tests que no miran la baja— o
  // `{ id, offboardedAt }`. Las dos formas valen; un id suelto significa
  // "existe y sin fecha de baja".
  const existing = (await lookup(companiesInLog)).map((row) =>
    typeof row === 'string'
      ? { id: row, offboardedAt: null }
      : { id: String(row.id ?? row._id), offboardedAt: row.offboardedAt || null }
  );
  // "Presente" = existe Y no esta dada de baja. Una compañia dada de baja sigue
  // en Mongo, asi que contarla como presente dejaria su log sin caducar nunca.
  const presentCompanies = new Set(existing.filter((c) => !c.offboardedAt).map((c) => c.id));
  const offboardedAt = new Map(
    existing.filter((c) => c.offboardedAt).map((c) => [c.id, new Date(c.offboardedAt)])
  );

  const { mark, clear, purge } = planRetention({
    companiesInLog,
    presentCompanies,
    absentSince,
    offboardedAt,
    now,
    days,
  });

  // --- O3: el mismo plan, con el operador como ancla -----------------------
  const [actorAbsentRows] = await connection.execute(
    'SELECT actor_user_id, first_absent_at FROM platform_audit_actor_retention'
  );
  const actorAbsentSince = new Map(
    actorAbsentRows.map((row) => [String(row.actor_user_id), new Date(row.first_absent_at)])
  );

  const operatorLookup = listActiveOperators || (async (ids) => {
    const { Types } = require('mongoose');
    const AdminUser = require('../models/AdminUser');
    const valid = ids.filter((id) => Types.ObjectId.isValid(id));
    if (!valid.length) return [];
    // `active: { $ne: false }` y no `active: true`: una cuenta antigua sin el
    // campo sigue siendo una cuenta en uso, y tratarla como baja le borraria el
    // historial a alguien que entra todos los dias.
    //
    // Se piden TODAS, activas o no, porque de las desactivadas interesa
    // `deactivatedAt`: es la fecha real de la baja, igual que `offboardedAt` lo
    // es para una compañia, y ahorra esperar a que el job observe la ausencia.
    const found = await AdminUser.find({ _id: { $in: valid } })
      .select('_id active deactivatedAt').lean();
    return found.map((doc) => ({
      id: String(doc._id),
      active: doc.active !== false,
      deactivatedAt: doc.deactivatedAt || null,
    }));
  });

  // Igual que con las compañias: un id suelto significa "activo, sin fecha".
  const operators = (await operatorLookup(actorsInLog)).map((row) =>
    typeof row === 'string'
      ? { id: row, active: true, deactivatedAt: null }
      : { id: String(row.id ?? row._id), active: row.active !== false, deactivatedAt: row.deactivatedAt || null }
  );
  const activeOperators = new Set(operators.filter((o) => o.active).map((o) => o.id));
  const deactivatedAt = new Map(
    operators
      .filter((o) => !o.active && o.deactivatedAt)
      .map((o) => [o.id, new Date(o.deactivatedAt)])
  );

  const actorPlan = planActorRetention({
    actorsInLog,
    activeOperators,
    absentSince: actorAbsentSince,
    deactivatedAt,
    now,
    days,
  });

  if (mode === 'warn') {
    if (purge.length) {
      logging.warn(
        'platform audit retention: would delete rows (PLATFORM_AUDIT_RETENTION_MODE=warn)',
        { companies: purge.map((p) => p.companyId), days }
      );
    }
    if (actorPlan.purge.length) {
      logging.warn(
        'platform audit retention: would delete company-less rows (PLATFORM_AUDIT_RETENTION_MODE=warn)',
        { operators: actorPlan.purge.map((p) => p.actorUserId), days }
      );
    }
    logging.info('[scheduler] platform-audit-retention (warn)', {
      scanned: companiesInLog.length,
      offboarded: offboardedAt.size,
      wouldMark: mark.length,
      wouldClear: clear.length,
      wouldPurge: purge.length,
      // De los que se borrarian, cuantos cuentan desde una fecha de baja real
      // en vez de desde el dia en que el job vio la ausencia.
      wouldPurgeFromDeclaredDate: purge.filter((p) => p.declared).length,
      orphanRows,
      orphanActors: actorsInLog.length,
      wouldMarkActors: actorPlan.mark.length,
      wouldClearActors: actorPlan.clear.length,
      wouldPurgeActors: actorPlan.purge.length,
      unanchorableRows,
    });
    return {
      mode, days,
      scanned: companiesInLog.length,
      marked: 0, cleared: 0,
      purgedCompanies: 0, deletedRows: 0,
      wouldMark: mark.length, wouldClear: clear.length, wouldPurge: purge.length,
      orphanRows,
      orphanActors: actorsInLog.length,
      purgedActors: 0, deletedOrphanRows: 0,
      wouldMarkActors: actorPlan.mark.length,
      wouldClearActors: actorPlan.clear.length,
      wouldPurgeActors: actorPlan.purge.length,
      unanchorableRows,
    };
  }

  // enforce
  const stamp = utcStamp(now);
  for (const companyId of mark) {
    await connection.execute(
      `INSERT INTO platform_audit_retention (company_id, first_absent_at, updated_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
      [companyId, stamp, stamp]
    );
  }
  for (const companyId of clear) {
    await connection.execute('DELETE FROM platform_audit_retention WHERE company_id = ?', [companyId]);
  }

  let deletedRows = 0;
  for (const item of purge) {
    const [outcome] = await connection.execute(
      'DELETE FROM platform_audit_log WHERE company_id = ?',
      [item.companyId]
    );
    deletedRows += Number(outcome?.affectedRows || 0);
    await connection.execute('DELETE FROM platform_audit_retention WHERE company_id = ?', [item.companyId]);
    logging.info('platform audit retention: deleted a former client rows', {
      companyId: item.companyId,
      absentForDays: item.days,
      countedFrom: item.declared ? 'Company.offboardedAt' : 'first_absent_at',
      rows: outcome?.affectedRows || 0,
    });
  }

  // --- O3: las filas sin compañia, ancladas al operador --------------------
  for (const actorUserId of actorPlan.mark) {
    await connection.execute(
      `INSERT INTO platform_audit_actor_retention (actor_user_id, first_absent_at, updated_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
      [actorUserId, stamp, stamp]
    );
  }
  for (const actorUserId of actorPlan.clear) {
    await connection.execute(
      'DELETE FROM platform_audit_actor_retention WHERE actor_user_id = ?',
      [actorUserId]
    );
  }

  let deletedOrphanRows = 0;
  for (const item of actorPlan.purge) {
    // `company_id IS NULL` en el WHERE no es una optimizacion: es el limite del
    // permiso. Las filas CON compañia de este mismo operador son datos del
    // cliente y las borra —o no— la regla del cliente.
    const [outcome] = await connection.execute(
      'DELETE FROM platform_audit_log WHERE company_id IS NULL AND actor_user_id = ?',
      [item.actorUserId]
    );
    deletedOrphanRows += Number(outcome?.affectedRows || 0);
    await connection.execute(
      'DELETE FROM platform_audit_actor_retention WHERE actor_user_id = ?',
      [item.actorUserId]
    );
    logging.info('platform audit retention: deleted a former operator company-less rows', {
      actorUserId: item.actorUserId,
      inactiveForDays: item.days,
      countedFrom: item.declared ? 'AdminUser.deactivatedAt' : 'first_absent_at',
      rows: outcome?.affectedRows || 0,
    });
  }

  if (unanchorableRows) {
    // Sin compañia y sin operador: no hay nada a lo que anclar la retencion, asi
    // que se quedan. Deberian ser cero; si no lo son, hay algo escribiendo filas
    // sin identidad y eso se mira antes que la retencion.
    logging.warn('platform audit retention: rows with neither company nor actor are kept', {
      rows: unanchorableRows,
    });
  }

  return {
    mode, days,
    scanned: companiesInLog.length,
    marked: mark.length,
    cleared: clear.length,
    purgedCompanies: purge.length,
    deletedRows,
    orphanRows,
    orphanActors: actorsInLog.length,
    markedActors: actorPlan.mark.length,
    clearedActors: actorPlan.clear.length,
    purgedActors: actorPlan.purge.length,
    deletedOrphanRows,
    unanchorableRows,
  };
};

module.exports = {
  runPlatformAuditRetention,
  planRetention,
  planActorRetention,
  retentionMode,
  retentionDays,
};
