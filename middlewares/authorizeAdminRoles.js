const AdminUser = require("../models/AdminUser");

const DEFAULT_ALLOWED_ROLES = ["Admin", "Super Admin", "Owner", "Manager", "Editor"];

const normalize = (value) => String(value || "").trim().toLowerCase();

const authorizeAdminRoles = (allowedRoles = DEFAULT_ALLOWED_ROLES) => {
  const normalizedAllowed = allowedRoles.map(normalize);

  return async (req, res, next) => {
    try {
      if (!req.uid) {
        return res.status(401).json({
          ok: false,
          msg: "Unauthorized",
        });
      }

      const adminUser = await AdminUser.findById(req.uid).select("role super_user active");

      if (!adminUser || adminUser.active === false) {
        return res.status(403).json({
          ok: false,
          msg: "Forbidden",
        });
      }

      const roleAllowed = normalizedAllowed.includes(normalize(adminUser.role));
      const isSuperUser = Boolean(adminUser.super_user);

      if (!roleAllowed && !isSuperUser) {
        return res.status(403).json({
          ok: false,
          msg: "Forbidden",
        });
      }

      req.adminRole = adminUser.role;
      req.isSuperUser = isSuperUser;
      return next();
    } catch (error) {
      return res.status(500).json({
        ok: false,
        msg: "Authorization failed",
      });
    }
  };
};

module.exports = {
  authorizeAdminRoles,
};
