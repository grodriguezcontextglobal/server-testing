/**
 * Observabilidad de la cola de tareas durable (ver DESIGN_task_queue.md).
 * host + /api/jobs
 *
 * Dos niveles de acceso:
 *  - /stats y /:jobId → super_user (observabilidad de plataforma; un job no
 *    pertenece a una sola compañía, por eso requireSuperUser en vez de
 *    authorizeMongoPermission).
 *  - /owned/:jobId → cualquier usuario autenticado, pero solo su PROPIO job
 *    (context.uid === req.uid). Habilita el polling del resultado por parte del
 *    usuario que originó la tarea (ej. subida de documento) sin exponerle jobs
 *    ajenos ni tocar la capa de super_user.
 */
const { Router } = require("express");
const { validateJWT } = require("../middlewares/validate-jwt");
const { requireSuperUser } = require("../middlewares/requireSuperUser");
const { getJobStatus, getJobStats, getOwnedJobStatus } = require("../controller/jobs");

const router = Router();

// IMPORTANTE: las rutas más específicas van ANTES de /:jobId, si no Express
// captura "stats"/"owned" como si fueran un jobId.
router.get("/stats", validateJWT, requireSuperUser, getJobStats);
router.get("/owned/:jobId", validateJWT, getOwnedJobStatus);
router.get("/:jobId", validateJWT, requireSuperUser, getJobStatus);

module.exports = router;
