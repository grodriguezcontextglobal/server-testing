
/**
 * Auth Route
 * host + /api/db_record/inserting-record
 */

const { Router } = require("express");
const { insertingRecordInEvent } = require("../controllers/recordEvent");
const router = Router();

//check item info
router.post("/inserting-record", insertingRecordInEvent)

module.exports = router;