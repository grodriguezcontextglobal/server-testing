const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const util = require('util');
const unlinkFile = util.promisify(fs.unlink);

// Configure S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

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
    const {
      companyId,
      documentType = 'general',
      metadata = {}
    } = options;

    if (!file || !companyId) {
      throw new Error('Missing required parameters: file, companyId');
    }

    // Validate file type
    if (file.mimetype !== 'application/pdf') {
      throw new Error('Only PDF files are allowed');
    }

    // Construct the S3 key with organized folder structure
    const key = `companies/${companyId}/${documentType}/${Date.now()}-${file.originalname}`;

    // Read file content
    const fileContent = fs.readFileSync(file.path);

    // Prepare S3 upload command
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Body: fileContent,
      ContentType: 'application/pdf',
      Metadata: {
        companyId,
        documentType,
        originalName: file.originalname,
        uploadDate: new Date().toISOString(),
        ...metadata
      }
    });

    // Upload to S3
    const uploadResult = await s3Client.send(uploadCommand);

    // Clean up temporary file
    await unlinkFile(file.path);

    return {
      ...uploadResult,
      Location: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
    };
  } catch (error) {
    // Clean up temporary file if it exists
    if (file && file.path) {
      await unlinkFile(file.path).catch(console.error);
    }
    console.error('S3 Upload Error:', {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      requestId: error.$metadata?.requestId,
      file: file?.originalname,
      options
    });
    throw error;
  }
};


function extractS3Key(fullUrl) {
    // Extract everything after the .com/ or first forward slash if .com isn't present
    const matches = fullUrl.match(/\.com\/(.*)|\/(.*)/);
    return matches ? matches[1] || matches[2] : null;
}

/**
 * Generates a temporary download URL for an S3 object
 * @param {string} key - The S3 object key
 * @param {number} expirationMinutes - URL expiration time in minutes (default: 5)
 * @returns {Promise<string>} - The temporary download URL
*/
const getTemporaryDownloadUrl = async (key, expirationMinutes = 5) => {
  const sanitazedKey = extractS3Key(key);
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: sanitazedKey
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: expirationMinutes * 60
    });

    return signedUrl;
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
      throw new Error('Missing required parameter: key');
    }

    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key
    });

    const deleteResult = await s3Client.send(command);
    return deleteResult;
  } catch (error) {
    throw new Error(`Failed to delete document: ${error.message}`);
  }
};

module.exports = { uploadPdfToS3, getTemporaryDownloadUrl, deleteDocumentFromS3 };
