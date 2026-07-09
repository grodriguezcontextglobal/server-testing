'use strict';

const AdminUser = require('../models/AdminUser');

/**
 * Gate simple para rutas de plataforma que cruzan todas las compañías (ej. los
 * endpoints de observabilidad de la cola de jobs). A diferencia de
 * authorizeMongoPermission, no hay un `company_id` con el que acotar el acceso
 * — un job de correo/log no pertenece a una sola compañía de forma natural —
 * así que la única puerta razonable es: solo super_user de plataforma.
 *
 * Prerrequisito: validateJWT debe correr antes (setea req.uid).
 */
const requireSuperUser = async (req, res, next) => {
  try {
    if (!req.uid) {
      return res.status(401).json({ ok: false, msg: 'Unauthorized' });
    }

    const adminUser = await AdminUser.findById(req.uid).select('super_user active');

    if (!adminUser || adminUser.active === false || !adminUser.super_user) {
      return res.status(403).json({ ok: false, msg: 'Forbidden' });
    }

    return next();
  } catch (err) {
    return res.status(500).json({ ok: false, msg: 'Authorization check failed' });
  }
};

module.exports = { requireSuperUser };
