const { Router } = require("express");
const { handleHeavyTask } = require("../controller/heavyTask");
// const { validateJWT } = require("../middlewares/validate-jwt"); // Use if you want protection

const router = Router();

// POST /api/heavy-task/process
// Accepts a file upload in real scenario
router.post("/process", handleHeavyTask);

module.exports = router;
