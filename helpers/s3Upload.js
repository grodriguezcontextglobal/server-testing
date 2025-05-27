const AWS = require("aws-sdk");
const fs = require("fs");
const util = require("util");
const unlinkFile = util.promisify(fs.unlink);

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

/**
 * Uploads a PDF file to AWS S3 with organized folder structure
 * @param {Object} file - The file object from multer
 * @param {Object} options - Upload options
 * @param {string} options.companyId - The company ID
 * @param {string} options.companyName - The company name for folder organization
 * @param {string} options.documentType - Type of document (e.g., 'policy', 'contract')
 * @param {Object} options.metadata - Additional metadata for the file
 * @returns {Promise<Object>} - The S3 upload result
 */
const uploadPdfToS3 = async (file, options) => {
  try {
    const { companyId, documentType = "general", metadata = {} } = options;

    if (!file || !companyId) {
      throw new Error("Missing required parameters: file, companyId");
    }

    // Validate file type
    if (file.mimetype !== "application/pdf") {
      throw new Error("Only PDF files are allowed");
    }

    // Construct the S3 key with organized folder structure
    const key = `companies/${companyId}/${documentType}/${Date.now()}-${
      file.originalname
    }`;

    // Read file content
    const fileContent = fs.readFileSync(file.path);

    // Prepare S3 upload parameters
    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Body: fileContent,
      ContentType: "application/pdf",
      Metadata: {
        companyId,
        documentType,
        originalName: file.originalname,
        uploadDate: new Date().toISOString(),
        ...metadata,
      },
    };

    // Upload to S3
    const uploadResult = await s3.upload(params).promise();

    // Clean up temporary file
    await unlinkFile(file.path);

    return uploadResult;
  } catch (error) {
    // Clean up temporary file if it exists
    if (file && file.path) {
      await unlinkFile(file.path).catch(console.error);
    }
    throw error;
  }
};

/**
 * Generates a temporary download URL for an S3 object
 * @param {string} key - The S3 object key
 * @param {number} expirationMinutes - URL expiration time in minutes (default: 5)
 * @returns {Promise<string>} - The temporary download URL
 */
const getTemporaryDownloadUrl = async (key, expirationMinutes = 5) => {
  try {
    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Expires: expirationMinutes * 60, // Convert minutes to seconds
    };

    const downloadUrl = await s3.getSignedUrlPromise("getObject", params);
    return downloadUrl;
  } catch (error) {
    throw new Error(`Failed to generate download URL: ${error.message}`);
  }
};

/**
 * Deletes a document from AWS S3
 * @param {string} key - The S3 object key to delete
 * @returns {Promise<Object>} - The S3 deletion result
 */
const deleteDocumentFromS3 = async (key) => {
  try {
    if (!key) {
      throw new Error("Missing required parameter: key");
    }
    console.log(key);
    // Prepare S3 delete parameters
    // Construct the S3 key with organized folder structure
    // const key = `companies/${companyId}/${documentType}/${Date.now()}-${file.originalname}`;
    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
    };

    const deleteResult = await s3.deleteObject(params).promise();
    return deleteResult;
  } catch (error) {
    throw new Error(`Failed to delete document: ${error.message}`);
  }
};

module.exports = {
  uploadPdfToS3,
  getTemporaryDownloadUrl,
  deleteDocumentFromS3,
};
