/**
 * Auth Route
 * host + /api/cloudinary
 */

const { Router } = require("express");
const router = Router();

const cloudinaryUploader = require("../cloudinary/connection");
//upload image to cloudinary
router.post("/upload-image", cloudinaryUploader);

module.exports = router;
