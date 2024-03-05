/**
 * Auth Route
 * host + /api/image
 */

const { Router } = require("express");
const { storingImage, retrieveImage } = require("../controller/image");
const router = Router();

// store image
router.post("/new_image", storingImage)

//display image
router.post("/images", retrieveImage)

module.exports = router;
