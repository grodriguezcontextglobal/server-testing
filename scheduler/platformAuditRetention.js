'use strict';

/**
 * Retencion de `platform_audit_log` (DC2; AU-11).
 *
 * LA REGLA ACORDADA: las filas de un cliente se guardan mientras el cliente
 * esta activo, mas 120 dias.
 *
 * EL PROBLEMA CON ESA REGLA, que conviene tener presente: **hoy el sistema no
 * sabe cuando un cliente deja de serlo.** El modelo Company no tiene ni bandera
 * de activo ni fecha de baja a nivel de compañia — `active` existe, pero dentro
 * de cada empleado de `employees[]`, que es otra cosa. Asi que no hay ningun
 * instante desde el que contar los 120 dias.
 *
 * Lo unico observable es que la compañia ya NO ESTA en Mongo. De ahi el diseño:
 *
 *   1. Compañia presente            -> no se borra nada suyo, nunca.
 *   2. Compañia ausente por primera
 *      vez                          -> se anota el dia en `platform_audit_retention`.
 *   3. Ausente desde hace >= 120 d  -> se borran TODAS sus filas.
 *   4. Reaparece                     -> se borra su anotacion; el contador vuelve a cero.
 *
 * Contar desde la fecha de cada fila en vez de desde la baja seria incorrecto en
 * el sentido peligroso: a un cliente dado de baja ayer se le borraria hoy mismo
 * todo lo anterior a hace 120 dias, que es exactamente la evidencia que la regla
 * quiere conservar.
 *
 * FILAS SIN COMPAÑIA (`company_id IS NULL`) — las busquedas que cruzan clientes
 * y `/me` — NO SE TOCAN. Su retencion es la pregunta O3, todavia sin respuesta.
 * El job las cuenta y lo dice en cada vuelta para que no se olviden.
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
 * @param {string[]} companiesInLog   ids de compañia presentes en el log
 * @param {Set<string>} presentCompanies  ids que SIGUEN existiendo en Mongo
 * @param {Map<string, Date>} absentSince ids ya anotados como ausentes, y desde cuando
 * @param {Date} now
 * @param {number} days
 * @returns {{mark: string[], clear: string[], purge: {companyId: string, absentSince: Date, days: number}[]}}
 */
const planRetention = ({ companiesInLog, presentCompanies, absentSince, now, days }) => {
  const mark = [];
  const clear = [];
  const purge = [];

  for (const companyId of companiesInLog) {
    if (presentCompanies.has(companyId)) {
      // Sigue siendo cliente: no se borra nada suyo. Y si estaba anotada como
      // ausente (volvio, o hubo un fallo de lectura en una vuelta anterior), se
      // le quita la anotacion para que el contador no siga corriendo.
      if (absentSince.has(companyId)) clear.push(companyId);
      continue;
    }

    const since = absentSince.get(companyId);
    if (!since) {
      mark.push(companyId);
      continue;
    }

    const elapsedDays = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
    if (elapsedDays >= days) {
      purge.push({ companyId, absentSince: since, days: elapsedDays });
    }
  }

  return { mark, clear, purge };
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
  logger: log,
} = {}) => {
  const mode = retentionMode(env);
  const days = retentionDays(env);
  const logging = log || require('../helpers/logger');

  if (mode === 'off') {
    return { mode, days, scanned: 0, marked: 0, cleared: 0, purgedCompanies: 0, deletedRows: 0, orphanRows: 0 };
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
    const found = await Company.find({ _id: { $in: valid } }).select('_id').lean();
    return found.map((doc) => String(doc._id));
  });

  const presentCompanies = new Set(await lookup(companiesInLog));

  const { mark, clear, purge } = planRetention({
    companiesInLog,
    presentCompanies,
    absentSince,
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
    logging.info('[scheduler] platform-audit-retention (warn)', {
      scanned: companiesInLog.length,
      wouldMark: mark.length,
      wouldClear: clear.length,
      wouldPurge: purge.length,
      orphanRows,
    });
    return {
      mode, days,
      scanned: companiesInLog.length,
      marked: 0, cleared: 0,
      purgedCompanies: 0, deletedRows: 0,
      wouldMark: mark.length, wouldClear: clear.length, wouldPurge: purge.length,
      orphanRows,
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
      rows: outcome?.affectedRows || 0,
    });
  }

  if (orphanRows) {
    // Recordatorio deliberado en cada vuelta: estas filas no caducan porque
    // nadie ha dicho todavia cuanto deben durar (pregunta O3).
    logging.info('platform audit retention: rows with no company are kept (O3 unanswered)', {
      rows: orphanRows,
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
  };
};

module.exports = {
  runPlatformAuditRetention,
  planRetention,
  retentionMode,
  retentionDays,
};
