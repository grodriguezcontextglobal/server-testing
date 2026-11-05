const cloudinary = require("cloudinary").v2;
require("dotenv").config({ quiet: true });

const cloudinaryUploader = async (request, response) => {
  try {
    // Configuration
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    // Extract the additional parameters from the request body
    const { imageFile, imageID, tags, context } = request.body;
    // Note: Cloudinary expects the property name 'tags', so you can map 'tag' to 'tags'
    const uploadResult = await cloudinary.uploader.upload(imageFile, {
      public_id: imageID,
      tags: tags,       // 'tag' from the client side (as an array)
      context: context // metadata as key=value pairs separated by '|'
    });

    // Optimize delivery by resizing and applying auto-format and auto-quality
    const optimizeUrl = cloudinary.source(uploadResult.public_id, {
      fetch_format: "auto",
      quality: "auto",
      type: "upload",
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
