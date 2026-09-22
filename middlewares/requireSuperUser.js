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
 *
 * NOTA (2026-09-17): ahora mismo NO lo monta ninguna ruta. Los dos endpoints de
 * observabilidad que lo usaban (/api/metrics y /api/jobs/stats) pasaron a
 * `requirePlatformRead`, porque para LEER un panel no hace falta el bypass total
 * de escritura que concede `super_user`. Se conserva a proposito: es la puerta
 * correcta el dia que haya un endpoint de plataforma que ESCRIBA.
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
