/**
 * Auth Route
 * host + /api/image
 */

const { Router } = require("express");
const { storingImage, retrieveImage } = require("../controller/image");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const router = Router();

// Anónimas hasta el 2026-10-19: /images hacía Image.find(body) para cualquiera y
// /new_image escribía sin sesión. Solo las llama el dashboard, con sesión.
const staffSession = [validateJWT, checkTokenVersion];

// store image
router.post("/new_image", staffSession, storingImage)

//display image
router.post("/images", staffSession, retrieveImage)

module.exports = router;
