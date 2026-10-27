/**
 * Auth Route
 * host + /api/cache
 */
const { Router } = require("express");
const updateCache = require("../middlewares/cacheUpdateDelete");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const router = Router();

//remove cache memory from outside
router.post('/remove-cache', validateJWT, checkTokenVersion, updateCache)

module.exports = router;
