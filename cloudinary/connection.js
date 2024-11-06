// import { v2 as cloudinary } from "cloudinary";
const cloudinary = require("cloudinary").v2;
require("dotenv").config();

const cloudinaryUploader = async (request, response) => {
  try {
    // Configuration
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET, // Click 'View API Keys' above to copy your API secret
    });

    const { imageFile, imageID } = request.body;
    // Upload an image
    const uploadResult = await cloudinary.uploader
      .upload(imageFile, {
        public_id: imageID,
      })
      .catch((error) => {
        console.log(error);
      });
    // Optimize delivery by resizing and applying auto-format and auto-quality
    const optimizeUrl = cloudinary.source(uploadResult.public_id, {
      fetch_format: "auto",
      quality: "auto",
      type:"upload",
    });

    response.status(201).json({
      ok: true,
      imageUploaded: uploadResult,
      imageOptimized: optimizeUrl,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

module.exports = cloudinaryUploader;
