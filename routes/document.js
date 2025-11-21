const { Router } = require("express");
const multer = require("multer");
const path = require("path");

const {
  uploadDocument,
  getCompanyDocuments,
  getDocumentTypes,
  getTriggerActions,
  getCompanyDocumentByID,
  getDocumentDownloadUrl,
  deleteDocument,
  generateTemporaryDownloadUrl,
  createNewFolder,
  getFolders,
  getFolderByID,
  updateFolder,
  deleteFolder,
  createStaffMemberVerification,
  staffMemberVerificationSignedDocumentForAssignmentDevices,
  addSignatureToDocument,
  createConsumerVerification,
  consumerMemberVerificationSignedDocumentForAssignmentDevices,
  addSignatureToConsumerDocument,
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

// Middleware for all routes
// router.use(validateJWT);

// Routes
router.post("/upload", upload.single("document"), uploadDocument);
router.get("/", getCompanyDocuments);
router.get("/types", getDocumentTypes);
router.get("/triggers", getTriggerActions);
router.get("/:id", getCompanyDocumentByID);
router.get("/download/:documentId/:userId", getDocumentDownloadUrl);
router.post("/download/documentUrl", generateTemporaryDownloadUrl);
router.delete("/:id", deleteDocument);
// Error handling middleware for multer errors
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        ok: false,
        msg: "File size is too large. Maximum size is 50MB",
      });
    }
    return res.status(400).json({
      ok: false,
      msg: error.message,
    });
  }
  next(error);
});
router.post("/new_folder", createNewFolder);
router.post("/folders", getFolders);
router.get("/folder/:id", getFolderByID);
router.put("/folder/:id", updateFolder);
router.delete("/folder/:id", deleteFolder);
router.post(
  "/verification/staff_member/signed_document",
  createStaffMemberVerification
);
router.post(
  "/verification/staff_member/check_signed_document",
  staffMemberVerificationSignedDocumentForAssignmentDevices
);
router.patch(
  "/verification/staff_member/signing_document",
  addSignatureToDocument
);

//verification consumer contract
router.post(
  "/verification/consumer_member/signed_document",
  createConsumerVerification
);
router.post(
  "/verification/consumer_member/check_signed_document",
  consumerMemberVerificationSignedDocumentForAssignmentDevices
);
router.patch(
  "/verification/consumer_member/signing_document",
  addSignatureToConsumerDocument
);

module.exports = router;
