const getConnection = require("../mysql/database/config");

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

const authorizePermission = (resource, action) => async (req, res, next) => {
  try {
    const staffId = req.sqlStaffId;
    const companyId = readCompanyId(req);

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
