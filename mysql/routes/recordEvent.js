
/**
 * Auth Route
 * host + /api/db_record
 */

const { Router } = require("express");
const { insertingRecordInEvent, insertingRecordInEventRefactored } = require("../controllers/recordEvent");
const { consultingRowInItemInvAssignedEventTable, deletingRecordInItemInvAssignedEventRow, consultingLeaseInformationConsumer } = require("../controllers/items_events");
const { validateJWT } = require("../../middlewares/validate-jwt");
const { checkTokenVersion } = require("../../middlewares/checkValidateToken");
const router = Router();

//check item info
router.post("/inserting-record", validateJWT, checkTokenVersion, insertingRecordInEvent)

//add item info for event record refactored
router.post("/inserting-record-refactored", validateJWT, checkTokenVersion, insertingRecordInEventRefactored)

//checking retrieve event info
router.post("/checking", validateJWT, checkTokenVersion, consultingRowInItemInvAssignedEventTable)

//checking retrieve event info
router.post("/removing-row-item-event-record", validateJWT, checkTokenVersion, deletingRecordInItemInvAssignedEventRow)

router.post("/checking-lease-information", validateJWT, checkTokenVersion, consultingLeaseInformationConsumer)

module.exports = router;