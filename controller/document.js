const {
  uploadPdfToS3,
  getTemporaryDownloadUrl,
  deleteDocumentFromS3,
} = require("../helpers/s3Upload");
const Document = require("../models/Document");
const Company = require("../models/Company");

const uploadDocument = async (req, res) => {
  try {
    const {
      document_type,
      trigger_action,
      at_,
      title,
      description,
      language,
      requires_signature,
      expiration_date,
      applicable_locations,
      applicable_items,
      applicable_events,
      tags,
      metadata,
      document_config,
      company_id,
      created_by,
    } = req.body;

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        msg: "No document file uploaded",
      });
    }

    // Get company details for folder organization
    const company = await Company.findById(company_id);
    if (!company) {
      return res.status(404).json({
        ok: false,
        msg: "Company not found",
      });
    }

    // Upload to S3 with organized folder structure
    const uploadResult = await uploadPdfToS3(req.file, {
      companyId: company_id,
      companyName: company.company_name,
      documentType: document_type,
      metadata: {
        trigger_action: trigger_action || undefined,
        // Only include tags if it exists in req.body
        ...(req.body.tags && { tags: encodeURIComponent(req.body.tags) }),
      },
    });

    // Parse JSON strings from form data
    const parsedMetadata = metadata ? JSON.parse(metadata) : undefined;
    const parsedConfig = document_config
      ? JSON.parse(document_config)
      : undefined;
    const parsedLocations = applicable_locations
      ? JSON.parse(applicable_locations)
      : undefined;
    const parsedItems = applicable_items
      ? JSON.parse(applicable_items)
      : undefined;
    const parsedEvents = applicable_events
      ? JSON.parse(applicable_events)
      : undefined;

      const splittingLocation = uploadResult.Location.split(".s3.us-east-2.amazonaws.com/")
    // Create document record
    // In uploadDocument function, modify the document creation:
    const document = new Document({
      company_id,
      document_url: `${process.env.AWS_S3_BUCKET_NAME}/${splittingLocation[1]}`, // Remove any extra spaces
      document_type,
      trigger_action,
      at_: new Date(at_),
      title,
      description,
      language,
      requires_signature: requires_signature === "true",
      expiration_date: expiration_date ? new Date(expiration_date) : undefined,
      applicable_locations: parsedLocations,
      applicable_items: parsedItems,
      applicable_events: parsedEvents,
      tags: tags ? JSON.parse(tags) : undefined,
      metadata: parsedMetadata,
      document_config: parsedConfig,
      created_by,
    });

    await document.save();

    res.status(201).json({
      ok: true,
      document,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: error,
    });
  }
};

const getCompanyDocuments = async (req, res) => {
  try {
    const { status, document_type, trigger_action, company_id } = req.query;
    const query = { company_id };
    if (status) query.status = status;
    if (document_type) query.document_type = document_type;
    if (trigger_action) query.trigger_action = trigger_action;

    const documents = await Document.find(query).sort({ created_at: -1 });

    res.json({
      ok: true,
      documents,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const getCompanyDocumentByID = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await Document.findById(id);

    res.json({
      ok: true,
      document,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const getDocumentTypes = async (req, res) => {
  try {
    const { company_id } = req.user;
    const types = await Document.getCompanyDocumentTypes(company_id);
    res.json({
      ok: true,
      types,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const getTriggerActions = async (req, res) => {
  try {
    const { company_id } = req.user;
    const actions = await Document.getCompanyTriggerActions(company_id);
    res.json({
      ok: true,
      actions,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const rateLimit = {};
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const MAX_REQUESTS = 10; // Maximum 10 requests per minute

const getDocumentDownloadUrl = async (req, res) => {
  try {
    const { userId } = req.params; // Assuming user ID is available from JWT auth

    // Check rate limit
    const now = Date.now();
    if (!rateLimit[userId]) {
      rateLimit[userId] = {
        count: 0,
        resetTime: now + RATE_LIMIT_WINDOW,
      };
    }

    // Reset counter if time window has passed
    if (now > rateLimit[userId].resetTime) {
      rateLimit[userId] = {
        count: 0,
        resetTime: now + RATE_LIMIT_WINDOW,
      };
    }

    // Check if rate limit exceeded
    if (rateLimit[userId].count >= MAX_REQUESTS) {
      return res.status(429).json({
        ok: false,
        msg: "Rate limit exceeded. Please try again later.",
        retryAfter: Math.ceil((rateLimit[userId].resetTime - now) / 1000),
      });
    }

    // Increment request counter
    rateLimit[userId].count++;

    const { documentId } = req.params;

    // Get document from database
    const document = await Document.findById(documentId);
    if (!document) {
      return res.status(404).json({
        ok: false,
        msg: "Document not found",
      });
    }

    // Clean up the document URL (remove extra spaces and backticks)
    const cleanUrl = document.document_url.trim().replace(/`/g, "");

    // Extract the key from the clean URL
    const key = decodeURIComponent(
      cleanUrl.split("/devitrak.documents.admin.dashboard/").pop()
    );

    // Generate temporary download URL
    const downloadUrl = await getTemporaryDownloadUrl(key);

    res.json({
      ok: true,
      downloadUrl,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({
        ok: false,
        msg: "Document not found",
      });
    }

    // Delete the document from S3
    const deleteResult = await deleteDocumentFromS3(document.document_url);
    if (!deleteResult) {
      return res.status(500).json({
        ok: false,
        msg: "Failed to delete document from S3",
      });
    }

    // Delete the document record from the database
    await Document.findByIdAndDelete(id);

    res.json({
      ok: true,
      msg: "Document deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

module.exports = {
  uploadDocument,
  getCompanyDocuments,
  getDocumentDownloadUrl,
  getDocumentTypes,
  getTriggerActions,
  getCompanyDocumentByID,
  deleteDocument,
};
