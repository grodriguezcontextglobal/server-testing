const {
  uploadPdfToS3,
  uploadExcelToS3: uploadExcelToS3Helper,
  getTemporaryDownloadUrl,
  deleteDocumentFromS3,
} = require("../helpers/s3Upload");
const Document = require("../models/Document");
const Company = require("../models/Company");
const Signatures = require("../models/Signatures");
const Folder = require("../models/Folder");
const EventSignature = require("../models/EventSignature");
const Verification = require("../models/Verification");
const {
  documentSigningCompletionNotification,
  consumerDocumentSigningCompletionNotification,
} = require("../nodeMailer/notifications");
const AdminUser = require("../models/AdminUser");
const logger = require("../helpers/logger");
const VerificationConsumersLeaseContracts = require("../models/VerificationConsumersLeaseContracts");
const SignatureConsumer = require("../models/SignatureConsumer");
const User = require("../models/User");
const VerificationMemberLeaseContracts = require("../models/VerificationMemberLeaseContracts");

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

    const splittingLocation = uploadResult.Location.split(
      ".s3.us-east-2.amazonaws.com/"
    );
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
    logger.error(error);
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

const generateTemporaryDownloadUrl = async (req, res) => {
  try {
    const { documentUrl } = req.body;
    const downloadUrl = await getTemporaryDownloadUrl(documentUrl);
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

const collectingSignatures = async (req, res) => {
  try {
    const {
      signature,
      date,
      contract_url,
      company_id,
      staff_member_id,
      item_ids = [],
      verification_id,
    } = req.body;
    req.body;
    const loginInfo = {
      timestamp: new Date().toLocaleString("en-US", {
        timeZone: req.headers["x-timezone"] || req.headers["timezone"] || "UTC",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      }),
      ipAddress:
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.headers["x-real-ip"] ||
        req.headers["x-client-ip"] ||
        req.ip ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        "Unknown",
      userAgent: req.headers["user-agent"] || "Unknown Browser",
      browser: req.headers["user-agent"]
        ? req.headers["user-agent"].split(" ")[0]
        : "Unknown",
      location:
        req.headers["x-location"] ||
        req.headers["cf-ipcountry"] ||
        req.headers["accept-language"]?.split(",")[0] ||
        "Unknown",
      timezone: req.headers["x-timezone"] || req.headers["timezone"] || "UTC",
    };

    const signatureData = new Signatures({
      signature,
      date,
      contract_url,
      company_id,
      staff_member_id,
      item_ids,
      verification_id,
      device_signature: {
        device_agent: loginInfo.userAgent,
        device_browser: loginInfo.browser,
        device_location: loginInfo.location,
        device_timezone: loginInfo.timezone,
        device_ip_address: loginInfo.ipAddress,
      },
    });
    await signatureData.save();
    res.status(200).json({
      ok: true,
      msg: "Signatures saved successfully",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};

const collectingSignaturesForConsumerMember = async (req, res) => {
  try {
    const {
      signature,
      date,
      contract_url,
      company_id,
      consumer_member_id,
      item_ids = [],
      verification_id,
    } = req.body;
    req.body;
    const loginInfo = {
      timestamp: new Date().toLocaleString("en-US", {
        timeZone: req.headers["x-timezone"] || req.headers["timezone"] || "UTC",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      }),
      ipAddress:
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.headers["x-real-ip"] ||
        req.headers["x-client-ip"] ||
        req.ip ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        "Unknown",
      userAgent: req.headers["user-agent"] || "Unknown Browser",
      browser: req.headers["user-agent"]
        ? req.headers["user-agent"].split(" ")[0]
        : "Unknown",
      location:
        req.headers["x-location"] ||
        req.headers["cf-ipcountry"] ||
        req.headers["accept-language"]?.split(",")[0] ||
        "Unknown",
      timezone: req.headers["x-timezone"] || req.headers["timezone"] || "UTC",
    };

    const signatureData = new SignatureConsumer({
      signature,
      date,
      contract_url,
      company_id,
      consumer_member_id,
      item_ids,
      verification_id,
      device_signature: {
        device_agent: loginInfo.userAgent,
        device_browser: loginInfo.browser,
        device_location: loginInfo.location,
        device_timezone: loginInfo.timezone,
        device_ip_address: loginInfo.ipAddress,
      },
    });
    await signatureData.save();
    res.status(200).json({
      ok: true,
      msg: "Signatures saved successfully",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};

// consultingSignaturesStaffMember
const consultingSignaturesStaffMember = async (req, res) => {
  try {
    const {
      staff_member_id,
      item_ids = [],
      company_id,
      contract_url,
      verification_id = null,
    } = req.body;

    // Normalize item_ids to strings (schema expects [String])
    const normalizedItemIds = Array.isArray(item_ids)
      ? item_ids.map((v) => String(v)).filter((v) => v.length > 0)
      : [];

    // Safely handle encoded contract_url
    const safeDecode = (s) => {
      if (typeof s !== "string") return s;
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };
    const decodedContractUrl = safeDecode(contract_url);

    // Use ObjectId where applicable
    const { Types } = require("mongoose");
    const normalizeObjectId = (v) =>
      typeof v === "string" && Types.ObjectId.isValid(v)
        ? new Types.ObjectId(v)
        : v;

    const query = {
      staff_member_id: normalizeObjectId(staff_member_id),
      company_id: normalizeObjectId(company_id),
      // Accept both encoded and decoded forms to avoid mismatch
      contract_url:
        typeof contract_url === "string" && contract_url.includes("%")
          ? { $in: [contract_url, decodedContractUrl] }
          : decodedContractUrl,
    };

    if (verification_id) {
      query.verification_id = verification_id;
    }
    // Require that the signature covers all requested items
    if (normalizedItemIds.length > 0) {
      query.item_ids = { $all: normalizedItemIds };
    }

    const consultingSignatures = await Signatures.find(query).lean();

    return res.status(200).json({
      ok: true,
      data: consultingSignatures,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};

const stampEventConsumerSignatures = async (req, res) => {
  try {
    const {
      signature,
      date,
      contract_url,
      company_id,
      event_id,
      accepted,
      consumer_id,
    } = req.body;
    const signatureData = new EventSignature({
      signature,
      date,
      contract_url,
      company_id,
      event_id,
      accepted,
      consumer_id,
    });
    await signatureData.save();
    res.status(200).json({
      ok: true,
      msg: "Signatures saved successfully",
      signature: signatureData,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};

const updateStampEventConsumerSignatures = async (request, response) => {
  try {
    const { signatureID, transactionID } = request.body;
    const signature = await EventSignature.findById(signatureID);
    if (!signature) {
      return response.status(404).json({
        ok: false,
        msg: "Signature not found",
      });
    }
    signature.transaction_id = transactionID;
    await signature.save();
    return response.status(200).json({
      ok: true,
      msg: "Signature updated successfully",
    });
  } catch (error) {}
};

const getConsumerSignatures = async (req, res) => {
  try {
    const { event_id, company_id, consumer_id } = req.body;
    const signatures = await EventSignature.find({
      event_id,
      company_id,
      consumer_id,
    });
    res.json({
      ok: true,
      signatures,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};

const createNewFolder = async (req, res) => {
  try {
    const {
      folder_name,
      folder_description,
      company_id,
      documents,
      trigger_action,
    } = req.body;
    if (
      !folder_name ||
      !folder_description ||
      !company_id ||
      !documents ||
      !trigger_action
    ) {
      return res.status(400).json({
        ok: false,
        msg: "Missing required fields",
      });
    }

    const folder = new Folder({
      folder_name,
      folder_description,
      documents,
      trigger_action,
      company_id,
    });
    await folder.save();
    res.status(201).json({
      ok: true,
      folder,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const getFolders = async (req, res) => {
  try {
    const { company_id } = req.body;
    const folders = await Folder.find({ company_id });
    if (folders.length === 0) {
      return res.status(404).json({
        ok: false,
        msg: "Folder not found",
      });
    }
    let structureResponse = [];
    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];
      const documents = await Document.find({
        _id: { $in: folder.documents.map((doc) => doc.document_id) },
      });
      structureResponse.push({
        folder_name: folder.folder_name,
        folder_description: folder.folder_description,
        folder_trigger_action: folder.trigger_action,
        folder_id: folder._id,
        documents: [
          ...documents.map((doc) => ({
            document_url: doc.document_url,
            document_id: doc._id,
            document_title: doc.title,
            trigger_action: doc.trigger_action,
          })),
        ],
      });
    }
    res.json({
      ok: true,
      folders: structureResponse,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const getFolderByID = async (req, res) => {
  try {
    const { id } = req.params;
    const folder = await Folder.findById(id); //.populate("documents");
    res.json({
      ok: true,
      folder,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const updateFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const { folder_name, folder_description, documents, trigger_action } =
      req.body;
    if (!folder_name || !folder_description || !documents || !trigger_action) {
      return res.status(400).json({
        ok: false,
        msg: "Missing required fields",
      });
    }

    const folder = await Folder.findById(id);
    if (!folder) {
      return res.status(404).json({
        ok: false,
        msg: "Folder not found",
      });
    }

    folder.folder_name = folder_name;
    folder.folder_description = folder_description;
    folder.documents = documents;
    folder.trigger_action = trigger_action;

    await folder.save();
    res.status(200).json({
      ok: true,
      folder,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const deleteFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const folder = await Folder.findById(id);
    if (!folder) {
      return res.status(404).json({
        ok: false,
        msg: "Folder not found",
      });
    }
    await Folder.findByIdAndDelete(id);
    res.status(200).json({
      ok: true,
      msg: "Folder deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const createStaffMemberVerification = async (req, res) => {
  try {
    const {
      company_id,
      contract_list,
      staff_member_id,
      date,
      assigner_staff_member_id,
    } = req.body;
    logger.error(req.body);
    const new_contract_verification = new Verification({
      date,
      company_id,
      staff_member_id,
      assigner_staff_member_id,
      contract_list: [
        ...contract_list.map((item) => {
          return {
            document_url: item.view_url,
            signature: false,
            date: Date.now().toLocaleString(),
          };
        }),
      ],
    });
    await new_contract_verification.save();
    logger.info(
      "Staff member verification created successfully",
      new_contract_verification
    );
    res.status(201).json({
      ok: true,
      msg: "Contract created successfully",
      verificationInfo: new_contract_verification,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};
const createConsumerVerification = async (req, res) => {
  try {
    const {
      company_id,
      contract_list,
      consumer_member_id,
      date,
      assigner_staff_member_id,
    } = req.body;
    logger.error(req.body);
    const new_contract_verification = new VerificationConsumersLeaseContracts({
      date,
      company_id,
      consumer_member_id,
      assigner_staff_member_id,
      contract_list: [
        ...contract_list.map((item) => {
          return {
            document_url: item.view_url,
            signature: false,
            date: Date.now().toLocaleString(),
          };
        }),
      ],
    });
    await new_contract_verification.save();
    logger.info(
      "Consumer member verification created successfully",
      new_contract_verification
    );
    res.status(201).json({
      ok: true,
      msg: "Contract created successfully",
      verificationInfo: new_contract_verification,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

const createMemberVerification = async (req, res) => {
  try {
    const {
      company_id,
      contract_list,
      member_id,
      date,
      assigner_staff_member_id,
    } = req.body;
    logger.error(req.body);
    const new_contract_verification = new VerificationMemberLeaseContracts({
      date,
      company_id,
      member_id,
      assigner_staff_member_id,
      contract_list: [
        ...contract_list.map((item) => {
          return {
            document_url: item.view_url,
            signature: false,
            date: Date.now().toLocaleString(),
          };
        }),
      ],
    });
    await new_contract_verification.save();
    logger.info(
      "Consumer member verification created successfully",
      new_contract_verification
    );
    res.status(201).json({
      ok: true,
      msg: "Contract created successfully",
      verificationInfo: new_contract_verification,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
    });
  }
};

// staffMemberVerificationSignedDocumentForAssignmentDevices
const staffMemberVerificationSignedDocumentForAssignmentDevices = async (
  req,
  res
) => {
  try {
    const {
      company_id,
      contract_url,
      staff_member_id,
      date_reference,
      verificationID,
    } = req.body;
    let matchedDoc = null;
    let matchedContract = null;
    let closestDelta = Infinity;

    if (verificationID) {
      const contract = await Verification.findById(verificationID).lean();
      if (!contract || contract.length === 0) return;
      if (
        Array.isArray(contract.contract_list) &&
        contract.contract_list.some((item) => item.signature === false)
      ) {
        return res.status(200).json({
          ok: true,
          msg: "Documents pending for signature",
          document: contract.contract_list.filter(
            (item) => item.signature === false
          ),
          contract_info: contract,
        });
      }

      return res.status(200).json({
        ok: true,
        msg: "Document signed successfully",
        document: contract.contract_list.filter(
          (item) => item.signature === true
        ),
        contract_info: contract,
      });
    }
    const parseDateSafe = (value) => {
      if (!value) return NaN;
      if (value instanceof Date) {
        const t = value.getTime();
        return Number.isNaN(t) ? NaN : t;
      }
      if (typeof value === "number") {
        return Number.isNaN(value) ? NaN : value;
      }
      const asNumber = Number(value);
      if (!Number.isNaN(asNumber) && asNumber > 1000000000) {
        return asNumber; // likely epoch ms or seconds (heuristic)
      }
      const d = new Date(value);
      const t = d.getTime();
      return Number.isNaN(t) ? NaN : t;
    };
    const refTs = parseDateSafe(date_reference);
    if (Number.isNaN(refTs)) {
      return res.status(400).json({
        ok: false,
        msg: "Invalid date_reference. Provide a parsable date or epoch ms.",
      });
    }

    const windowStart = refTs - 10 * 60 * 1000; // -10 minutes
    const windowEnd = refTs + 10 * 60 * 1000; // +10 minutes

    // Find all contracts for staff and company (date is stored as String, so range queries won't be reliable at DB level)
    const contracts = await Verification.find({
      company_id,
      staff_member_id,
    }).lean();

    if (!contracts || contracts.length === 0) {
      return res.status(201).json({
        ok: false,
        msg: "Contract not found",
      });
    }

    for (const contract of contracts) {
      const contractList = Array.isArray(contract.contract_list)
        ? contract.contract_list
        : [];

      for (const doc of contractList) {
        if (doc.document_url !== contract_url) continue;

        // Prefer document date, fallback to contract date
        const contractTs = parseDateSafe(contract?.date);
        const tsCandidate = contractTs;

        if (Number.isNaN(tsCandidate)) continue;

        if (contractTs >= windowStart && contractTs <= windowEnd) {
          const delta = Math.abs(tsCandidate - refTs);
          if (delta < closestDelta) {
            closestDelta = delta;
            matchedDoc = contract_url;
            matchedContract = contract;
          }
        }
      }
    }

    if (!matchedDoc) {
      return res.status(201).json({
        ok: false,
        msg: "Document not found within the ±10 minute window",
      });
    }

    if (matchedDoc.signature === false) {
      return res.status(200).json({
        ok: true,
        msg: "Document pending for signature",
        document: matchedDoc,
        contract_info: matchedContract,
      });
    }

    return res.status(200).json({
      ok: true,
      msg: "Document signed successfully",
      document: matchedDoc,
      contract_info: matchedContract,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};
const consumerMemberVerificationSignedDocumentForAssignmentDevices = async (
  req,
  res
) => {
  try {
    const {
      company_id,
      contract_url,
      consumer_member_id,
      date_reference,
      verificationID,
    } = req.body;
    let matchedDoc = null;
    let matchedContract = null;
    let closestDelta = Infinity;

    if (verificationID) {
      const contract = await VerificationConsumersLeaseContracts.findById(
        verificationID
      ).lean();
      if (!contract || contract.length === 0) return;
      if (
        Array.isArray(contract.contract_list) &&
        contract.contract_list.some((item) => item.signature === false)
      ) {
        return res.status(200).json({
          ok: true,
          msg: "Documents pending for signature",
          document: contract.contract_list.filter(
            (item) => item.signature === false
          ),
          contract_info: contract,
        });
      }

      return res.status(200).json({
        ok: true,
        msg: "Document signed successfully",
        document: contract.contract_list.filter(
          (item) => item.signature === true
        ),
        contract_info: contract,
      });
    }
    const parseDateSafe = (value) => {
      if (!value) return NaN;
      if (value instanceof Date) {
        const t = value.getTime();
        return Number.isNaN(t) ? NaN : t;
      }
      if (typeof value === "number") {
        return Number.isNaN(value) ? NaN : value;
      }
      const asNumber = Number(value);
      if (!Number.isNaN(asNumber) && asNumber > 1000000000) {
        return asNumber; // likely epoch ms or seconds (heuristic)
      }
      const d = new Date(value);
      const t = d.getTime();
      return Number.isNaN(t) ? NaN : t;
    };
    const refTs = parseDateSafe(date_reference);
    if (Number.isNaN(refTs)) {
      return res.status(400).json({
        ok: false,
        msg: "Invalid date_reference. Provide a parsable date or epoch ms.",
      });
    }

    const windowStart = refTs - 10 * 60 * 1000; // -10 minutes
    const windowEnd = refTs + 10 * 60 * 1000; // +10 minutes

    // Find all contracts for staff and company (date is stored as String, so range queries won't be reliable at DB level)
    const contracts = await VerificationConsumersLeaseContracts.find({
      company_id,
      consumer_member_id,
    }).lean();

    if (!contracts || contracts.length === 0) {
      return res.status(201).json({
        ok: false,
        msg: "Contract not found",
      });
    }

    for (const contract of contracts) {
      const contractList = Array.isArray(contract.contract_list)
        ? contract.contract_list
        : [];

      for (const doc of contractList) {
        if (doc.document_url !== contract_url) continue;

        // Prefer document date, fallback to contract date
        const contractTs = parseDateSafe(contract?.date);
        const tsCandidate = contractTs;

        if (Number.isNaN(tsCandidate)) continue;

        if (contractTs >= windowStart && contractTs <= windowEnd) {
          const delta = Math.abs(tsCandidate - refTs);
          if (delta < closestDelta) {
            closestDelta = delta;
            matchedDoc = contract_url;
            matchedContract = contract;
          }
        }
      }
    }

    if (!matchedDoc) {
      return res.status(201).json({
        ok: false,
        msg: "Document not found within the ±10 minute window",
      });
    }

    if (matchedDoc.signature === false) {
      return res.status(200).json({
        ok: true,
        msg: "Document pending for signature",
        document: matchedDoc,
        contract_info: matchedContract,
      });
    }

    return res.status(200).json({
      ok: true,
      msg: "Document signed successfully",
      document: matchedDoc,
      contract_info: matchedContract,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};

const memberVerificationSignedDocumentForAssignmentDevices = async (
  req,
  res
) => {
  try {
    const {
      company_id,
      contract_url,
      member_id,
      date_reference,
      verificationID,
    } = req.body;
    let matchedDoc = null;
    let matchedContract = null;
    let closestDelta = Infinity;

    if (verificationID) {
      const contract = await VerificationMemberLeaseContracts.findById(
        verificationID
      ).lean();
      if (!contract || contract.length === 0) return;
      if (
        Array.isArray(contract.contract_list) &&
        contract.contract_list.some((item) => item.signature === false)
      ) {
        return res.status(200).json({
          ok: true,
          msg: "Documents pending for signature",
          document: contract.contract_list.filter(
            (item) => item.signature === false
          ),
          contract_info: contract,
        });
      }

      return res.status(200).json({
        ok: true,
        msg: "Document signed successfully",
        document: contract.contract_list.filter(
          (item) => item.signature === true
        ),
        contract_info: contract,
      });
    }
    const parseDateSafe = (value) => {
      if (!value) return NaN;
      if (value instanceof Date) {
        const t = value.getTime();
        return Number.isNaN(t) ? NaN : t;
      }
      if (typeof value === "number") {
        return Number.isNaN(value) ? NaN : value;
      }
      const asNumber = Number(value);
      if (!Number.isNaN(asNumber) && asNumber > 1000000000) {
        return asNumber; // likely epoch ms or seconds (heuristic)
      }
      const d = new Date(value);
      const t = d.getTime();
      return Number.isNaN(t) ? NaN : t;
    };
    const refTs = parseDateSafe(date_reference);
    if (Number.isNaN(refTs)) {
      return res.status(400).json({
        ok: false,
        msg: "Invalid date_reference. Provide a parsable date or epoch ms.",
      });
    }

    const windowStart = refTs - 10 * 60 * 1000; // -10 minutes
    const windowEnd = refTs + 10 * 60 * 1000; // +10 minutes

    // Find all contracts for staff and company (date is stored as String, so range queries won't be reliable at DB level)
    const contracts = await VerificationConsumersLeaseContracts.find({
      company_id,
      consumer_member_id,
    }).lean();

    if (!contracts || contracts.length === 0) {
      return res.status(201).json({
        ok: false,
        msg: "Contract not found",
      });
    }

    for (const contract of contracts) {
      const contractList = Array.isArray(contract.contract_list)
        ? contract.contract_list
        : [];

      for (const doc of contractList) {
        if (doc.document_url !== contract_url) continue;

        // Prefer document date, fallback to contract date
        const contractTs = parseDateSafe(contract?.date);
        const tsCandidate = contractTs;

        if (Number.isNaN(tsCandidate)) continue;

        if (contractTs >= windowStart && contractTs <= windowEnd) {
          const delta = Math.abs(tsCandidate - refTs);
          if (delta < closestDelta) {
            closestDelta = delta;
            matchedDoc = contract_url;
            matchedContract = contract;
          }
        }
      }
    }

    if (!matchedDoc) {
      return res.status(201).json({
        ok: false,
        msg: "Document not found within the ±10 minute window",
      });
    }

    if (matchedDoc.signature === false) {
      return res.status(200).json({
        ok: true,
        msg: "Document pending for signature",
        document: matchedDoc,
        contract_info: matchedContract,
      });
    }

    return res.status(200).json({
      ok: true,
      msg: "Document signed successfully",
      document: matchedDoc,
      contract_info: matchedContract,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};

const addSignatureToDocument = async (req, res) => {
  try {
    const { verification_id, contract_url } = req.body;
    const contract = await Verification.findById(verification_id);
    if (!contract) {
      return res.status(404).json({
        ok: false,
        msg: "Contract not found",
      });
    }
    const contractList = contract.contract_list;
    const document = contractList.findIndex(
      (doc) => doc.document_url === contract_url
    );
    if (document < 0) {
      return res.status(404).json({
        ok: false,
        msg: "Document not found",
      });
    }

    let signature = contractList[document];
    signature.signature = true;
    signature.date = new Date().toLocaleString();
    contractList[document] = signature;
    const updatedVerification = await Verification.findByIdAndUpdate(
      verification_id,
      {
        contract_list: contractList,
      },
      {
        new: true,
      }
    );
    const checkIfAllContractsSigned = updatedVerification.contract_list.every(
      (item) => item.signature === true
    );
    if (checkIfAllContractsSigned) {
      // Send email notifications to both assigner and staff member
      try {
        const assigner = await AdminUser.findById(
          updatedVerification.assigner_staff_member_id
        );
        const staff = await AdminUser.findById(
          updatedVerification.staff_member_id
        );
        const notificationPayload = {
          assigner: {
            name:
              `${assigner.name} ${assigner.lastName}` || "Equipment Assigner",
            email: assigner.email,
          },
          staff: {
            name: `${staff.name} ${staff.lastName}` || "Staff Member",
            email: staff.email,
          },
          contract_list: updatedVerification.contract_list,
          verification_id: updatedVerification._id,
        };

        // Call the notification function directly (internal call)
        await documentSigningCompletionNotification(
          { body: notificationPayload },
          {
            status: (code) => ({
              json: (data) => {
                logger.error(`Notification response: ${code}`, data);
                return data;
              },
            }),
          }
        );
      } catch (notificationError) {
        console.error(
          "Failed to send completion notifications:",
          notificationError
        );
        // Don't fail the main operation if notification fails
      }
    }

    return res.status(200).json({
      ok: true,
      msg: "Document signed successfully",
      document,
      contract_info: updatedVerification,
      all_signed: checkIfAllContractsSigned,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};
const addSignatureToConsumerDocument = async (req, res) => {
  try {
    const { verification_id, contract_url } = req.body;
    const contract = await VerificationConsumersLeaseContracts.findById(
      verification_id
    );
    if (!contract) {
      return res.status(404).json({
        ok: false,
        msg: "Contract not found",
      });
    }
    const contractList = contract.contract_list;
    const document = contractList.findIndex(
      (doc) => doc.document_url === contract_url
    );
    if (document < 0) {
      return res.status(404).json({
        ok: false,
        msg: "Document not found",
      });
    }

    let signature = contractList[document];
    signature.signature = true;
    signature.date = new Date().toLocaleString();
    contractList[document] = signature;
    const updatedVerification =
      await VerificationConsumersLeaseContracts.findByIdAndUpdate(
        verification_id,
        {
          contract_list: contractList,
        },
        {
          new: true,
        }
      );
    const checkIfAllContractsSigned = updatedVerification.contract_list.every(
      (item) => item.signature === true
    );
    if (checkIfAllContractsSigned) {
      // Send email notifications to both assigner and staff member
      try {
        const assigner = await AdminUser.findById(
          updatedVerification.assigner_staff_member_id
        );
        const consumer = await User.findById(
          updatedVerification.consumer_member_id
        );
        const notificationPayload = {
          assigner: {
            name:
              `${assigner.name} ${assigner.lastName}` || "Equipment Assigner",
            email: assigner.email,
          },
          consumer: {
            name: `${consumer.name} ${consumer.lastName}` || "Consumer Member",
            email: consumer.email,
          },
          contract_list: updatedVerification.contract_list,
          verification_id: updatedVerification._id,
        };

        // Call the notification function directly (internal call)
        try {
          await consumerDocumentSigningCompletionNotification(
            { body: notificationPayload },
            {
              status: (code) => ({
                json: (data) => {
                  logger.error(`Notification response: ${code}`, data);
                  return data;
                },
              }),
            }
          );
        } catch (error) {
          logger.error("Failed to send completion notifications:", error);
        }
      } catch (notificationError) {
        logger.error(
          "Failed to send completion notifications:",
          notificationError
        );
        // Don't fail the main operation if notification fails
      }
    }

    return res.status(200).json({
      ok: true,
      msg: "Document signed successfully",
      document,
      contract_info: updatedVerification,
      all_signed: checkIfAllContractsSigned,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};

const addSignatureToMemberDocument = async (req, res) => {
  try {
    const { verification_id, contract_url } = req.body;
    const contract = await VerificationMemberLeaseContracts.findById(
      verification_id
    );
    if (!contract) {
      return res.status(404).json({
        ok: false,
        msg: "Contract not found",
      });
    }
    const contractList = contract.contract_list;
    const document = contractList.findIndex(
      (doc) => doc.document_url === contract_url
    );
    if (document < 0) {
      return res.status(404).json({
        ok: false,
        msg: "Document not found",
      });
    }

    let signature = contractList[document];
    signature.signature = true;
    signature.date = new Date().toLocaleString();
    contractList[document] = signature;
    const updatedVerification =
      await VerificationConsumersLeaseContracts.findByIdAndUpdate(
        verification_id,
        {
          contract_list: contractList,
        },
        {
          new: true,
        }
      );
    const checkIfAllContractsSigned = updatedVerification.contract_list.every(
      (item) => item.signature === true
    );
    if (checkIfAllContractsSigned) {
      // Send email notifications to both assigner and staff member
      return res.status(200).json({
        ok: true,
        msg: "All documents signed successfully",
        document,
        contract_info: updatedVerification,
        all_signed: checkIfAllContractsSigned,
      });
    }

    return res.status(200).json({
      ok: true,
      msg: "Document signed successfully",
      document,
      contract_info: updatedVerification,
      all_signed: checkIfAllContractsSigned,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: JSON.stringify(error),
    });
  }
};

const uploadExcelToS3 = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        msg: "No document file uploaded",
      });
    }

    const { company_id, company } = req.body;
    if (!company_id) {
      return res.status(400).json({
        ok: false,
        msg: "company id is required",
      });
    }

    const uploadResult = await uploadExcelToS3Helper(req.file, {
      companyId: company_id,
      documentType: "inventory-import",
    });

    const signedUrl = await getTemporaryDownloadUrl(uploadResult.Key);

    // Fetch to another server for handle inserting company inventory from xlsx file
    const targetUrl = process.env.INVENTORY_IMPORT_WEBHOOK_URL;

    if (targetUrl) {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileUrl: signedUrl,
          callbackURLSuccess: process.env.callbackUrl_WEBHOOK_URL_SUCCESS,
          callbackURLFail: process.env.callbackUrl_WEBHOOK_URL_FAIL,
          company_id: company_id,
          company: company,  
          userEmail: req.user ? req.user.email : undefined,
          user_sql_id: req.user ? req.user.id : req.body.contact_staff_id,
        }),
      });
      logger.info(">>>>>>>", response);
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `Failed to trigger inventory import: ${response.status} ${errorText}`
        );
        return res.status(502).json({
          ok: false,
          msg: "File uploaded to S3 but failed to trigger inventory import on remote server.",
          error: errorText,
        });
      }

      //     {
      //   "status": "completed",
      //   "total_rows": 100,
      //   "success": 98,
      //   "failed": 2,
      //   "errors": ["Row 5: Invalid cost"],
      //   "company_id": "comp_123",
      //   "user_email": "user@example.com",
      //   "user_sql_id": 123
      // }
      logger.info("Inventory import process triggered successfully", response);
    } else {
      logger.warn(
        "INVENTORY_IMPORT_WEBHOOK_URL is not defined. Skipping remote import trigger."
      );
    }

    res.status(200).json({
      ok: true,
      msg: "File uploaded and import process triggered",
      data: {
        s3Location: uploadResult.Location,
        signedUrl: signedUrl,
      },
    });
  } catch (error) {
    logger.error(error);
    res.status(500).json({
      ok: false,
      msg: error.message,
      err: error,
    });
  }
};

module.exports = {
  uploadExcelToS3,
  addSignatureToConsumerDocument,
  addSignatureToDocument,
  addSignatureToMemberDocument,
  collectingSignatures,
  collectingSignaturesForConsumerMember,
  consultingSignaturesStaffMember,
  consumerMemberVerificationSignedDocumentForAssignmentDevices,
  createConsumerVerification,
  createNewFolder,
  createStaffMemberVerification,
  createMemberVerification,
  deleteDocument,
  deleteFolder,
  generateTemporaryDownloadUrl,
  getCompanyDocumentByID,
  getCompanyDocuments,
  getConsumerSignatures,
  getDocumentDownloadUrl,
  getDocumentTypes,
  getFolderByID,
  getFolders,
  getTriggerActions,
  memberVerificationSignedDocumentForAssignmentDevices,
  staffMemberVerificationSignedDocumentForAssignmentDevices,
  stampEventConsumerSignatures,
  updateFolder,
  updateStampEventConsumerSignatures,
  uploadDocument,
};
