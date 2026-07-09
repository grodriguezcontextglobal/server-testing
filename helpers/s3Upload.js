const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require("fs");
const util = require("util");
const logger = require("./logger");
const unlinkFile = util.promisify(fs.unlink);

// Configure S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
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

    // Prepare S3 upload command
    const uploadCommand = new PutObjectCommand({
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
    throw error;
  }
};

/**
 * Uploads an Excel file to AWS S3 with organized folder structure
 * @param {Object} file - The file object from multer
 * @param {Object} options - Upload options
 * @param {string} options.companyId - The company ID
 * @param {string} options.companyName - The company name for folder organization
 * @param {string} options.documentType - Type of document (e.g., 'inventory')
 * @param {Object} options.metadata - Additional metadata for the file
 * @returns {Promise<Object>} - The S3 upload result
 */
const uploadExcelToS3 = async (file, options) => {
  try {
    const { companyId, documentType = "inventory", metadata = {} } = options;

    if (!file || !companyId) {
      throw new Error("Missing required parameters: file, companyId");
    }

    // Validate file type
    const allowedMimeTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
      "application/vnd.ms-excel", // .xls
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new Error("Only Excel files (.xlsx, .xls) are allowed");
    }

    // Construct the S3 key with organized folder structure
    const key = `companies/${companyId}/${documentType}/${Date.now()}-${
      file.originalname
    }`;

    // Read file content
    const fileContent = fs.readFileSync(file.path);

    // Prepare S3 upload command
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Body: fileContent,
      ContentType: file.mimetype,
      Metadata: {
        companyId,
        documentType,
        originalName: file.originalname,
        uploadDate: new Date().toISOString(),
        ...metadata,
      },
    });

    // Upload to S3
    const uploadResult = await s3Client.send(uploadCommand);

    // Clean up temporary file
    await unlinkFile(file.path);

    return {
      ...uploadResult,
      Location: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
      Key: key,
    };
  } catch (error) {
    // Clean up temporary file if it exists
    if (file && file.path) {
      await unlinkFile(file.path).catch(console.error);
    }
    throw error;
  }
};

/**
 * Sube un adjunto de correo (base64) a S3 antes de encolar el envío (ver
 * nodeMailer/notifications.js § returnedItemsToRenterNotification). El job de
 * la cola solo guarda la key devuelta aquí, nunca el base64 — evita acercarse
 * al límite de 16MB por documento de MongoDB con adjuntos grandes.
 * @param {Object} params
 * @param {string} params.content - Contenido en base64.
 * @param {string} params.filename
 * @param {string} [params.contentType]
 * @returns {Promise<{key: string}>}
 */
const uploadNotificationAttachment = async ({ content, filename, contentType }) => {
  const key = `notification-attachments/${Date.now()}-${filename}`;
  const buffer = Buffer.from(content, "base64");

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
    })
  );

  return { key };
};

const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });

/**
 * Descarga un objeto de S3 y lo devuelve como base64 — usado por el worker
 * justo antes de enviar el correo, para resolver los `attachmentRefs` del job
 * a los `attachments` reales que espera SendGrid.
 * @param {string} key
 * @returns {Promise<string>} contenido en base64
 */
const fetchAttachmentAsBase64 = async (key) => {
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
  });

  const response = await s3Client.send(command);
  const buffer = await streamToBuffer(response.Body);
  return buffer.toString("base64");
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
  let sanitazedKey = key;
  const bucketName = process.env.AWS_S3_BUCKET_NAME;

  // Only sanitize if it looks like a URL or starts with the bucket name
  if (
    key.includes(".com/") ||
    (bucketName && key.startsWith(`${bucketName}/`))
  ) {
    sanitazedKey = extractS3Key(key);
  }

  try {
    logger.info(`Generating download URL for key: ${sanitazedKey}`);
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: sanitazedKey,
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: expirationMinutes * 60,
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
      throw new Error("Missing required parameter: key");
    }

    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
    });

    const deleteResult = await s3Client.send(command);
    return deleteResult;
  } catch (error) {
    throw new Error(`Failed to delete document: ${error.message}`);
  }
};

module.exports = {
  uploadPdfToS3,
  uploadExcelToS3,
  uploadNotificationAttachment,
  fetchAttachmentAsBase64,
  getTemporaryDownloadUrl,
  deleteDocumentFromS3,
};
