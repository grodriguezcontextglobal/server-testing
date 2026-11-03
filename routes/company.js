/**
 * Auth Route
 * host + /api/company
 */

const { Router } = require("express");
const { consumerTokenGate } = require("../middlewares/consumerTokenGate");
const multer = require("multer");
const { validateJWT } = require("../middlewares/validate-jwt");
const { checkTokenVersion } = require("../middlewares/checkValidateToken");
const { authorizeMongoPermission } = require("../middlewares/authorizeMongoPermission");
const { requireCompanyAuth } = require("../middlewares/companyAuth");
const { optionalJWT } = require("../middlewares/optionalJWT");
const { contractLinkGate } = require("../middlewares/contractLinkAuth");
const path = require("path");
const {
  createCompany,
  updatingCompany,
  searchingCompany,
  getCompanyList,
  searchingGetCompanyInfo,
  assignLocationToUser,
} = require("../controller/company");
const { linkStripeAccountAtRegistration } = require("../controller/companyRegistrationStripe");
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

// Namespace-wide access control. Defaults to `warn`: it logs unauthenticated
// callers and blocks nothing, so this deploy changes no behaviour. Only one of
// the routes below (PATCH /update-company/:id) has ever checked anything, and
// several of the rest write to Mongo and to S3. See middlewares/companyAuth.js
// for the modes and for how to read the logs before switching to `enforce`.
router.use(requireCompanyAuth);

router.post("/new", createCompany);

router.patch("/update-company/:id", validateJWT, checkTokenVersion, authorizeMongoPermission("company", "update"), updatingCompany);

// Sin sesión (alta de compañía): solo conecta la cuenta de Stripe, una vez y
// en compañías recién creadas. Antes guardaba el body entero de cualquier
// compañía. Ver controller/companyRegistrationStripe.js.
router.patch("/update-company/register-process/:id", linkStripeAccountAtRegistration);

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
// /display-contracts del consumidor: sesión de staff o token del enlace del
// correo (middlewares/contractLinkAuth.js). optionalJWT, para reconocer al staff.
router.post(
  "/signatures-for-consumer-member",
  optionalJWT,
  contractLinkGate({
    subject: (req) => ({
      company_id: req.body?.company_id,
      consumer_member_id: req.body?.consumer_member_id,
      verification_id: req.body?.verification_id,
      contract_url: req.body?.contract_url,
    }),
  }),
  collectingSignaturesForConsumerMember
);
//consulting staff signatures
router.post("/consulting-signatures", consultingSignaturesStaffMember);

//get consumer signatures
router.post(
  "/consumer-signatures",
  optionalJWT,
  contractLinkGate({
    subject: (req) => ({
      company_id: req.body?.company_id,
      consumer_member_id: req.body?.consumer_member_id,
      contract_url: req.body?.contract_url,
    }),
  }),
  getConsumerSignatures
);

//event consumer signatures
router.post(
  "/event-consumer-signatures",
  consumerTokenGate({
    eventScoped: true,
    subject: (req) => ({
      consumerId: req.body?.consumer_id,
      eventId: req.body?.event_id,
      companyId: req.body?.company_id,
    }),
  }),
  stampEventConsumerSignatures
);

//transaction id added to event consumer signatures
// App del consumidor: token válido (fase C). La firma no se compara con el
// token: necesitaría buscarla (pendiente).
router.patch("/update-signatures", consumerTokenGate(), updateStampEventConsumerSignatures);

//get specific provider company
router.post("/provider-company/:id", getSpecificProviderCompany);

module.exports = router;
