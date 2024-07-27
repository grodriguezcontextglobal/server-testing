
/**
 * Auth Route
 * host + /api/db_record/inserting-record
 */

const { Router } = require("express");
const { insertingRecordInEvent } = require("../controllers/recordEvent");
const { consultingRowInItemInvAssignedEventTable, deletingRecordInItemInvAssignedEventRow } = require("../controllers/items_events");
const router = Router();

//check item info
router.post("/inserting-record", insertingRecordInEvent)

//checking retrieve event info
router.post("/checking", consultingRowInItemInvAssignedEventTable)

//checking retrieve event info
router.post("/removing-row-item-event-record", deletingRecordInItemInvAssignedEventRow)

module.exports = router;