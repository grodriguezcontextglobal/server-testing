/**
 * Console de plataforma — host + /api/platform
 *
 * LA CADENA, que es lo importante de este fichero:
 *
 *   validateJWT -> checkTokenVersion -> auditPlatformAccess -> requirePlatformConsole -> handler
 *
 * Las cuatro se aplican con `router.use`, no ruta a ruta, A PROPOSITO: una ruta
 * nueva de DC3 que se olvide de la cadena seria una lectura de datos de cliente
 * sin puerta y sin registro. Montandola en el router, olvidarse no es una
 * opcion. Es el mismo motivo por el que `companyAuth` se monta asi en
 * routes/company.js.
 *
 * EL ORDEN NO ES EL QUE PROPUSO EL DASHBOARD. Su nota ponia la auditoria
 * DESPUES del gate; va antes, porque si fuera despues una denegacion cortaria
 * en el gate y no dejaria fila — y "una lectura denegada" es precisamente la
 * fila que un evaluador busca primero. Ver auditPlatformAccess.js.
 *
 * NO lleva `authorizePermission`: eso resuelve permisos DENTRO de una compañia y
 * el console no actua dentro de ninguna. Tampoco `companyAuth` ni
 * `COMPANY_CONTEXT_MODE`, que solo viven en /api/company y dentro de
 * authorizePermission respectivamente — por eso la exencion que pidio DC1 no
 * hacia falta.
 */
const { Router } = require("express");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { auditPlatformAccess } = require("../middlewares/auditPlatformAccess");
const { requirePlatformConsole } = require("../middlewares/requirePlatformConsole");
const { platformMe } = require("../controller/platform");

const router = Router();

router.use(validateJWT);
router.use(checkTokenVersion);
router.use(auditPlatformAccess);
router.use(requirePlatformConsole);

// M1: solo esta. Las 20 de lectura y POST /exports son DC3 y cuelgan de aqui.
router.get("/me", platformMe);

module.exports = router;
