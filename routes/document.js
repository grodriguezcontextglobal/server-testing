const { Router } = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// tmp/uploads está gitignoreado (tmp/uploads/), así que puede no existir en un
// checkout limpio o si el OS/limpiador de temporales lo borra. Multer
// diskStorage NO crea el directorio destino → falla al escribir con
// "ENOENT ... open 'tmp/uploads/...'" ANTES de llegar al controller (500).
// Se garantiza que exista, tanto al cargar el módulo como en cada upload.
const UPLOAD_DIR = "tmp/uploads";
const ensureUploadDir = () => fs.mkdirSync(UPLOAD_DIR, { recursive: true });
ensureUploadDir();

const {
  uploadDocument,
  uploadExcelToS3,
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
  createMemberVerification,
  memberVerificationSignedDocumentForAssignmentDevices,
  addSignatureToMemberDocument,
} = require("../controller/document");

// Configure multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // recursive:true es idempotente; cubre el caso de que el dir se borre en runtime.
    try {
      ensureUploadDir();
      cb(null, UPLOAD_DIR);
    } catch (err) {
      cb(err);
    }
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

const xlsxFileFilter = (req, file, cb) => {
  // Accept XLSX files only
  // Validate file type
  const allowedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/vnd.ms-excel", // .xls
  ];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only XLSX files are allowed"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

const uploadXLSX = multer({
  storage: storage,
  fileFilter: xlsxFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

const router = Router();

// Middleware for all routes
// router.use(validateJWT);

// Routes
router.post("/upload", upload.single("document"), uploadDocument);
router.post("/upload/xlsx", uploadXLSX.single("document"), uploadExcelToS3);
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

router.post("/verification/member/signed_document", createMemberVerification);

router.post(
  "/verification/member/check_signed_document",
  memberVerificationSignedDocumentForAssignmentDevices
);

router.patch(
  "/verification/member/signing_document",
  addSignatureToMemberDocument
);

module.exports = router;
