/**
 * Auth Route
 * host + /api/cache
 */
const { Router } = require("express");
const updateCache = require("../middlewares/cacheUpdateDelete");
const router = Router();

//remove cache memory from outside
router.post('/remove-cache', updateCache)

module.exports = router;
