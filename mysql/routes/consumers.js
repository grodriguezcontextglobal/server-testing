/**
 * Auth Route
 * host + /api/db_consumer
 */

const { Router } = require("express");
const { consultingConsumerInfo, insertingCustomer, consultingConsumerTable, deleteCustomer } = require("../controllers/consumer");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const { authorizePermission } = require("../../middlewares/authorizePermission");

const router = Router();

//check consumer info
router.post("/consulting-consumer", consultingConsumerInfo)

//check all table
router.post('/consumers_information', consultingConsumerTable)

//insert new consumer
router.post('/new_consumer', insertingCustomer)

//delete consumer
router.delete('/:id', validateJWT, checkTokenVersion, authorizePermission("consumer", "delete"), deleteCustomer)

module.exports = router;
