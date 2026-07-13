/**
 * Auth Route
 * host + /api/db_consumer
 */

const { Router } = require("express");
const { consultingConsumerInfo, insertingCustomer, consultingConsumerTable, deleteCustomer } = require("../controllers/consumer");

const router = Router();

//check consumer info
router.post("/consulting-consumer", consultingConsumerInfo)

//check all table
router.post('/consumers_information', consultingConsumerTable)

//insert new consumer
router.post('/new_consumer', insertingCustomer)

//delete event
router.delete('/:id', deleteCustomer)

module.exports = router;
