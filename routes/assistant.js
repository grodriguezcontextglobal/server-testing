'use strict';

/**
 * Asistente de staff. host + /api/assistant
 *
 * POR QUE UN ESPACIO DE NOMBRES PROPIO Y NO /api/admin/assistant, que es lo que
 * propuso el dashboard: una ruta nueva dentro de un router existente puede
 * quedar tapada por un parametro que ya este registrado antes. En este repo eso
 * no es teorico — `router.post("/:id")` en item.js tapaba catorce rutas
 * (test/routeShadowing.test.js). Un espacio de nombres nuevo no puede
 * ensombrecer ni ser ensombrecido por nada.
 *
 * CADENA DE AUTORIZACION, en orden y sin nada nuevo:
 *   validateJWT       identidad firmada -> request.uid, request.sqlStaffId
 *   checkTokenVersion la sesion sigue viva (no se revoco ni se cerro)
 *   limitador         coste y abuso
 *   el controlador    compañia + alcance via resolveCompanyContext
 *
 * La membresia y el alcance NO se comprueban aqui sino dentro, porque
 * `resolveCompanyContext` es asincrono y devuelve el 403 ya redactado. Meterlo
 * en un middleware propio seria un segundo sitio donde vive la misma decision.
 */

const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const { validateJWT } = require('../middlewares/validate-jwt');
const { checkTokenVersion } = require('../middlewares/checkValidateToken');
const { assistantAsk, assistantCatalog } = require('../controller/assistant');

const WINDOW_MS = Number(process.env.ASSISTANT_RATE_WINDOW_MS || 600_000); // 10 min
const MAX_PER_STAFF = Number(process.env.ASSISTANT_RATE_MAX || 10);

/**
 * Limite POR MIEMBRO DE STAFF, no por IP.
 *
 * Por IP seria el limite equivocado en los dos sentidos: una oficina entera
 * detras de una sola salida compartiria presupuesto, y una persona con dos redes
 * tendria el doble. La clave es `request.uid`, que viene del token firmado y por
 * tanto no se puede elegir. La IP solo se usa si no hay token, caso que no
 * deberia llegar aqui porque validateJWT va antes — es un cinturon, no la regla.
 *
 * EL STORE ES EN MEMORIA Y ESO TIENE UN COSTE CONOCIDO: si algun dia la API corre
 * en varios procesos, el limite real se multiplica por el numero de procesos.
 * `rate-limit-redis` ya es dependencia del proyecto y no se usa en ningun sitio
 * todavia; cuando este limite proteja algo que cueste dinero de verdad —un
 * modelo— ese es el momento de moverlo, no antes.
 */
const assistantRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_PER_STAFF,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => String(request.uid || request.ip || 'unknown'),
  message: {
    ok: false,
    msg: 'Too many questions in a short time. Try again in a few minutes.',
  },
});

const router = Router();

router.get('/catalog', validateJWT, checkTokenVersion, assistantCatalog);
router.post('/ask', validateJWT, checkTokenVersion, assistantRateLimit, assistantAsk());

module.exports = router;
