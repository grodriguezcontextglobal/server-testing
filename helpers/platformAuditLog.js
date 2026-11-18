'use strict';

const getConnection = require('../mysql/database/config');

/**
 * Escritor de `platform_audit_log` (DC2; AU-2, AU-9, AU-12).
 *
 * SINCRONO Y FAIL-CLOSED, que es la diferencia con `logStaffActivity`.
 * `logStaffActivity` encola: si la escritura falla, reintenta y la peticion
 * sigue. Aqui no se puede: el requisito es que una lectura del console que no
 * deja constancia NO se sirva. Por eso esta funcion **lanza** cuando el INSERT
 * falla, y quien la llama convierte eso en un 503 sin cuerpo util.
 *
 * Nunca se escribe lo que se leyo, solo QUE se leyo: ruta, parametros, estado y
 * numero de registros. `details` no debe llevar nunca filas de cliente — es un
 * registro de acceso, no una copia de los datos.
 */

const ACTIONS = Object.freeze(['view', 'search', 'export', 'signin', 'access_change']);
const RESULTS = Object.freeze(['allowed', 'denied']);

/** Vocabulario cerrado de motivos de denegacion. Lo produce el gate. */
const DENY_REASONS = Object.freeze({
  NO_SESSION: 'no_session',
  UNKNOWN_ACCOUNT: 'unknown_account',
  INACTIVE_ACCOUNT: 'inactive_account',
  NOT_PLATFORM_OBSERVER: 'not_platform_observer',
  WRONG_DOMAIN: 'wrong_domain',
  MFA_REQUIRED: 'mfa_required',
});

/**
 * `at` se escribe en UTC a mano. `NOW()` daria la hora del servidor de base de
 * datos, que no tiene por que ser UTC ni la misma que la del servidor de
 * aplicacion; para una evidencia de auditoria esa ambiguedad no vale.
 * Formato MySQL DATETIME(3): 'YYYY-MM-DD HH:MM:SS.mmm'.
 */
const utcStamp = (date = new Date()) =>
  date.toISOString().replace('T', ' ').replace('Z', '');

const clip = (value, max) => {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
};

const INSERT = `INSERT INTO platform_audit_log
  (at, actor_user_id, actor_email, action, company_id, resource, details, ip, geo, user_agent, result, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * @param {object} row
 * @param {object} [deps]
 * @param {Function} [deps.getConnectionFn]  Inyectable: los tests no tienen MySQL.
 * @returns {Promise<{insertId: number}>}
 * @throws  si el INSERT falla. Es deliberado: ver cabecera.
 */
const writePlatformAuditRow = async (row, { getConnectionFn = getConnection } = {}) => {
  const action = ACTIONS.includes(row?.action) ? row.action : null;
  if (!action) {
    // Un `action` fuera del vocabulario es un fallo de programacion, no un dato
    // del usuario: se detiene aqui en vez de guardar una fila que luego nadie
    // sabe interpretar.
    throw new Error(`platform_audit_log: unknown action "${row?.action}"`);
  }
  const result = RESULTS.includes(row?.result) ? row.result : null;
  if (!result) {
    throw new Error(`platform_audit_log: unknown result "${row?.result}"`);
  }
  if (!row?.resource) {
    throw new Error('platform_audit_log: resource is required');
  }

  const values = [
    utcStamp(row.at instanceof Date ? row.at : new Date()),
    clip(row.actorUserId, 24),
    clip(row.actorEmail, 255),
    action,
    clip(row.companyId, 64),
    clip(row.resource, 255),
    row.details === null || row.details === undefined ? null : JSON.stringify(row.details),
    clip(row.ip, 45),
    clip(row.geo, 128),
    clip(row.userAgent, 512),
    result,
    result === 'denied' ? clip(row.reason, 64) : null,
  ];

  const connection = getConnectionFn();
  const [outcome] = await connection.execute(INSERT, values);
  return { insertId: outcome?.insertId };
};

module.exports = {
  writePlatformAuditRow,
  ACTIONS,
  RESULTS,
  DENY_REASONS,
  utcStamp,
};
