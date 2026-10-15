/**
 * Auth Route
 * host + /api/db_consumer
 */

const { Router } = require("express");
const { consultingConsumerInfo, insertingCustomer, consultingConsumerTable, deleteCustomer } = require("../controllers/consumer");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");
const { optionalJWT } = require("../../middlewares/optionalJWT");
const { requireSessionFromDashboard } = require("../../middlewares/attendanceLinkAuth");

const router = Router();

//check consumer info
router.post("/consulting-consumer", consultingConsumerInfo)

//check all table
router.post('/consumers_information', consultingConsumerTable)

//insert new consumer
// La app del consumidor la llama sin token. Desde el dashboard sin sesión era la
// página /attendance-confirmation, que ya confirma por su propia ruta.
router.post('/new_consumer', optionalJWT, requireSessionFromDashboard, insertingCustomer)

//delete consumer
router.delete('/:id', validateJWT, checkTokenVersion, authorizePermission("consumer", "delete"), deleteCustomer)

module.exports = router;
