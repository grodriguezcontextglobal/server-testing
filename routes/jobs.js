/**
 * Observabilidad de la cola de tareas durable (ver DESIGN_task_queue.md).
 * host + /api/jobs
 *
 * Dos niveles de acceso:
 *  - /stats y /:jobId → `requirePlatformRead` (observabilidad de plataforma; un
 *    job no pertenece a una sola compañía, por eso no vale
 *    authorizeMongoPermission — y tampoco `requireSuperUser`, que es bypass
 *    total de escritura: para leer un panel basta un flag de solo lectura).
 *  - /owned/:jobId → cualquier usuario autenticado, pero solo su PROPIO job
 *    (context.uid === req.uid). Habilita el polling del resultado por parte del
 *    usuario que originó la tarea (ej. subida de documento) sin exponerle jobs
 *    ajenos ni tocar la capa de plataforma.
 */
const { Router } = require("express");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { requirePlatformRead } = require("../middlewares/requirePlatformRead");
const { getJobStatus, getJobStats, getOwnedJobStatus } = require("../controller/jobs");

const router = Router();

// IMPORTANTE: las rutas más específicas van ANTES de /:jobId, si no Express
// captura "stats"/"owned" como si fueran un jobId.
router.get("/stats", validateJWT, checkTokenVersion, requirePlatformRead, getJobStats);
router.get("/owned/:jobId", validateJWT, checkTokenVersion, getOwnedJobStatus);
router.get("/:jobId", validateJWT, checkTokenVersion, requirePlatformRead, getJobStatus);

module.exports = router;
