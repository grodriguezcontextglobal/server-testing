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
const {
  platformMe,
  platformCompanies,
  platformSummary,
  platformInventory,
  platformTransactions,
  platformEvents,
  platformActivity,
  platformCompanyDetail,
  platformAttention,
  platformCompanyActivity,
  platformCompanyTransactions,
  platformCompanyEvents,
  platformCompanyInventory,
  platformCompanyMembers,
  platformCompanyConsumers,
  platformCompanyStaff,
  platformCompanySubscription,
  platformCompanyMerchant,
} = require("../controller/platform");

const router = Router();

router.use(validateJWT);
router.use(checkTokenVersion);
router.use(auditPlatformAccess);
router.use(requirePlatformConsole);

router.get("/me", platformMe);

// DC3, primera tanda. Estas dos y no otras porque son las que el dashboard
// dijo que cablearia primero al apagar sus datos de muestra. Las demas cuelgan
// de esta misma cadena, sin tocarla.
router.get("/summary", platformSummary());
router.get("/companies", platformCompanies());

// DC3, segunda tanda. Las cinco que el console ya llamaba y respondian 404.
//
// `/companies/:id` va DESPUES de `/companies` y eso no es casualidad: express
// resuelve por orden de registro, asi que una ruta con parametro declarada
// antes que su hermana literal se la come. Es el mismo sombreado que tapo
// catorce rutas en routes/item.js.
router.get("/inventory", platformInventory());
router.get("/transactions", platformTransactions());
router.get("/events", platformEvents());
router.get("/activity", platformActivity());
router.get("/companies/:id", platformCompanyDetail());

// DC3, tercera tanda: las nueve pestañas de la ficha de un cliente.
//
// Una ruta por recurso, NO `/companies/:id/:resource`. Con un comodin, pedir
// una pestaña que no servimos daria 200 o 400 y el console no podria
// distinguir "esa pestaña no existe" de "existe y no tiene datos". Asi un
// recurso que no esta da 404 de verdad.
//
// `merchant` esta registrada y contesta 501 con la razon: todo lo que enseña
// es estado de Stripe y este servidor solo guarda el formulario de alta.
router.get("/companies/:id/activity", platformCompanyActivity());
router.get("/companies/:id/transactions", platformCompanyTransactions());
router.get("/companies/:id/events", platformCompanyEvents());
router.get("/companies/:id/inventory", platformCompanyInventory());
router.get("/companies/:id/members", platformCompanyMembers());
router.get("/companies/:id/consumers", platformCompanyConsumers());
router.get("/companies/:id/staff", platformCompanyStaff());
router.get("/companies/:id/subscription", platformCompanySubscription());
router.get("/companies/:id/merchant", platformCompanyMerchant());

// `/attention` SI se sirve, con una de sus tres condiciones midiendo y las
// otras dos declaradas en el cuerpo de la respuesta.
//
// Antes quedaba fuera a proposito, y el razonamiento era bueno a medias: una
// pantalla que promete tres avisos y mide uno engaña MENOS que una pantalla
// que no existe, siempre que diga cual mide. Una lista vacia con
// `conditions.devicesOverdue.active: false` dice algo muy distinto de una
// lista vacia a secas, y es el console quien decide como pintarlo.
router.get("/attention", platformAttention());

module.exports = router;
