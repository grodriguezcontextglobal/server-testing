const getConnection = require("../mysql/database/config");
const logger = require("../helpers/logger");

/**
 * Middleware de autorización basado en el sistema SQL de role_permissions.
 * Requiere que validateJWT haya corrido primero (req.uid = AdminUser._id).
 * El company_id se lee de: req.params.company_id, req.body.company_id, o req.query.company_id.
 *
 * Uso en rutas:
 *   router.patch('/update-contact', validateJWT, authorizePermission('staff','update_contact'), handler)
 *   router.post('/inventory',       validateJWT, authorizePermission('inventory','create'),       handler)
 */
/**
 * De dónde sale la compañía contra la que se comprueba el permiso.
 *
 * El header `s-company-lq` es el ÚLTIMO recurso, no el primero: params, body y
 * query mandan, así que para las rutas que ya funcionaban no cambia nada.
 *
 * Existe porque hay rutas que identifican el recurso por la URL y no llevan
 * `company_id` en ninguna de esas tres fuentes —`/sub-locations/:id` es el
 * caso—, y ahí este middleware respondía 401 «missing company_id» a TODA
 * petición, token válido incluido. El cliente manda ese header en cualquier
 * ruta `/api/db_*`, y `resolveCompanyContext` ya lo trata como fuente
 * preferente, así que esto solo alinea las dos comprobaciones.
 *
 * No afloja nada: el header no otorga permisos, solo dice contra qué compañía
 * preguntar, y la consulta de abajo sigue exigiendo pertenencia activa con el
 * permiso concreto.
 */
const readCompanyId = (req) =>
  req.params?.company_id ||
  req.body?.company_id ||
  req.query?.company_id ||
  (typeof req.header === "function" ? req.header("s-company-lq") : undefined);

/**
 * Compañía del body/params/query frente a la del header `s-company-lq`
 * (2.7 del dashboard, 2026-11-04). Este middleware comprueba el permiso contra
 * la del body, y los controladores que usan `resolveCompanyContext` actúan
 * sobre la del header: si no coinciden, se podía tener permiso en una y
 * escribir en la otra (la membresía se comprobaba en ambas, pero no el
 * permiso). COMPANY_CONTEXT_MODE:
 *   warn (por defecto): lo registra y sigue como antes;
 *   enforce: 403;
 *   off: no compara.
 */
const companyContextMode = () => String(process.env.COMPANY_CONTEXT_MODE || "warn").toLowerCase();

const companyContextMismatch = (req) => {
  const explicit = req.params?.company_id || req.body?.company_id || req.query?.company_id;
  const header = typeof req.header === "function" ? req.header("s-company-lq") : undefined;
  if (!explicit || !header || String(explicit) === String(header)) return null;
  return { explicit: String(explicit), header: String(header) };
};

const authorizePermission = (resource, action) => async (req, res, next) => {
  try {
    const staffId = req.sqlStaffId;
    const companyId = readCompanyId(req);

    const mode = companyContextMode();
    const mismatch = mode === "off" ? null : companyContextMismatch(req);
    if (mismatch) {
      const detail = {
        method: req.method,
        path: req.originalUrl?.split("?")[0] ?? req.path,
        origin: req.headers?.origin,
        ip: req.ip,
        reason: "body company differs from s-company-lq",
        ...mismatch,
      };
      if (mode === "enforce") {
        logger.warn("company context: body and header disagree, rejected", detail);
        return res.status(403).json({ ok: false, msg: "Forbidden: company_id does not match the company context" });
      }
      logger.warn("company context: body and header disagree (COMPANY_CONTEXT_MODE=warn)", detail);
    }

    if (!staffId || !companyId) {
      return res.status(401).json({ ok: false, msg: "Unauthorized: missing staff identity or company_id" });
    }

    const connection = getConnection();
    const [rows] = await connection.query(
      `SELECT 1
       FROM company_staff cs
       JOIN role_permissions rp ON cs.role_id = rp.role_id
       JOIN permissions p ON rp.permission_id = p.id
       WHERE cs.company_id = ? AND cs.staff_id = ? AND cs.is_active = 1
         AND p.resource = ? AND p.action = ?
       LIMIT 1`,
      [companyId, staffId, resource, action]
    );

    if (!rows.length) {
      return res.status(403).json({ ok: false, msg: "Forbidden: insufficient permissions" });
    }
    next();
  } catch (error) {
    return res.status(500).json({ ok: false, msg: "Authorization check failed" });
  }
};

module.exports = { authorizePermission, readCompanyId };
