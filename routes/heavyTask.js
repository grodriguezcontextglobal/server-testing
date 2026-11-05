const { Router } = require("express");
const { handleHeavyTask } = require("../controller/heavyTask");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { validateJWT } = require("../middlewares/validate-jwt");

const router = Router();

// POST /api/heavy-task/process
// Accepts a file upload in real scenario
router.post("/process", validateJWT, checkTokenVersion, handleHeavyTask);

module.exports = router;
