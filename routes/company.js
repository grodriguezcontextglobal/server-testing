/**
 * Auth Route
 * host + /api/company
 */

const { Router } = require("express");
const multer = require("multer");
const path = require("path");
const {
  createCompany,
  updatingCompany,
  searchingCompany,
  getCompanyList,
  searchingGetCompanyInfo,
  assignLocationToUser,
} = require("../controller/company");
const {
  createProviderCompany,
  updateProviderCompany,
  uploadProviderDocument,
  getProviderCompanies,
  getSpecificProviderCompany,
} = require("../controller/providerCompany");
const {
  collectingSignatures,
  collectingSignaturesForConsumerMember,
  getConsumerSignatures,
  stampEventConsumerSignatures,
  consultingSignaturesStaffMember,
  updateStampEventConsumerSignatures,
} = require("../controller/document");

// Configure multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "tmp/uploads");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const fileFilter = (req, file, cb) => {
  // Accept PDF files only
  if (file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error("Only PDF files are allowed"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

const router = Router();

router.post("/new", createCompany);

router.patch("/update-company/:id", updatingCompany);

router.post("/search-company", searchingCompany);

router.get("/search-company", searchingGetCompanyInfo);

router.post("/companies", getCompanyList);

router.post("/assign-location", assignLocationToUser);

//providers company
// Create new provider company
router.post("/new_provider", createProviderCompany);

// Update existing provider company
router.patch("/update_provider/:id", updateProviderCompany);

// Upload document for provider company
router.post(
  "/provider-upload-document/:id",
  upload.single("document"),
  uploadProviderDocument
);

// Get provider companies
router.get("/provider-companies", getProviderCompanies);

//signatures contract
router.post("/signatures", collectingSignatures);

//collecting signatures for consumer member
router.post(
  "/signatures-for-consumer-member",
  collectingSignaturesForConsumerMember
);
//consulting staff signatures
router.post("/consulting-signatures", consultingSignaturesStaffMember);

//get consumer signatures
router.post("/consumer-signatures", getConsumerSignatures);

//event consumer signatures
router.post("/event-consumer-signatures", stampEventConsumerSignatures);

//transaction id added to event consumer signatures
router.patch("/update-signatures", updateStampEventConsumerSignatures);

//get specific provider company
router.post("/provider-company/:id", getSpecificProviderCompany);

module.exports = router;
