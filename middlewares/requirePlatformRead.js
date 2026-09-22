'use strict';

const AdminUser = require('../models/AdminUser');

/**
 * Gate de SOLO LECTURA para los endpoints de observabilidad de plataforma
 * (`/api/metrics`, `/api/jobs/stats`), que agregan datos de TODAS las compañías.
 *
 * Existe porque los dos flags que ya había servían mal a este caso, cada uno por
 * un extremo:
 *
 *  - `AdminUser.super_user` es el flag de **bypass TOTAL** de
 *    `authorizeMongoPermission` (ver ese fichero, § "Bypass global"). Concederlo
 *    para que alguien pueda leer un panel es concederle escritura en todas las
 *    compañías. Demasiado.
 *  - `Company.employees[].super_user` lo tiene el **dueño de cada compañía
 *    cliente** — se siembra al registrarla (`controller/registration.js:128`) —
 *    y estos endpoints incluyen un top de clientes por volumen, que es dato de
 *    OTROS inquilinos. Demasiado poco.
 *
 * De ahí un flag propio: acotado a lectura de observabilidad, y sin ningún poder
 * de escritura.
 *
 * `super_user` sigue pasando, a propósito: es un superconjunto deliberado, no un
 * olvido.
 *
 * PRERREQUISITO: `validateJWT` debe correr ANTES (es quien setea `req.uid`). Sin
 * él este gate no queda más estricto, queda **inalcanzable** — responde 401 a
 * todo. Es exactamente el bug que tuvo `/api/metrics` hasta `8f9edab`, así que
 * el 401 de aquí abajo lleva mensaje propio para que se distinga del de un token
 * inválido.
 *
 * Fábrica inyectable para poder probarlo sin Mongo, como el resto del repo.
 */
const createRequirePlatformRead = ({
  findAdminUser = (uid) =>
    AdminUser.findById(uid).select('super_user platform_observer active'),
} = {}) => async (req, res, next) => {
  try {
    if (!req.uid) {
      return res.status(401).json({
        ok: false,
        msg: 'Unauthorized: no session identity on this request',
      });
    }

    const adminUser = await findAdminUser(req.uid);

    if (!adminUser || adminUser.active === false) {
      return res.status(403).json({ ok: false, msg: 'Forbidden' });
    }

    if (!adminUser.super_user && !adminUser.platform_observer) {
      // Mensaje explícito a propósito: el 403 anterior no decía QUÉ hacía falta,
      // y averiguarlo costó una tarde.
      return res.status(403).json({
        ok: false,
        msg: 'Forbidden: platform observability requires platform_observer',
      });
    }

    return next();
  } catch (err) {
    return res.status(500).json({ ok: false, msg: 'Authorization check failed' });
  }
};

const requirePlatformRead = createRequirePlatformRead();

module.exports = { requirePlatformRead, createRequirePlatformRead };
