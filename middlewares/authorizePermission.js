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
const authorizePermission = (resource, action) => async (req, res, next) => {
  try {
    const staffId   = req.sqlStaffId;
    const companyId = req.params?.company_id || req.body?.company_id || req.query?.company_id;

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

module.exports = { authorizePermission };
