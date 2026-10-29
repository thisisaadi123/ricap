// Document vault (PRD 8.7): upload parsing, saving and access rules.
const crypto = require("crypto");
const multer = require("multer");
const { httpError } = require("./http.js");
const { putFile, deleteFile } = require("./storage.js");
const { hasRestrictedAccess } = require("./identity.js");
const { isVisible } = require("./visibility.js");

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

// Single file under the form field "file", kept in memory until saved.
const uploadOne = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
    cb(httpError(400, "Upload a PDF, JPG, PNG, WEBP or Word file."));
  },
}).single("file");

// Express middleware: parses the upload and turns multer's errors into
// readable 400s.
function receiveFile(req, res, next) {
  uploadOne(req, res, (err) => {
    if (!err) {
      if (!req.file) return next(httpError(400, "Choose a file to upload."));
      return next();
    }
    if (err.code === "LIMIT_FILE_SIZE") return next(httpError(400, "That file is over 10 MB."));
    next(err.status ? err : httpError(400, err.message));
  });
}

function safeName(name) {
  const cleaned = String(name || "file").normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-120);
  return cleaned || "file";
}

// Saves the uploaded file to storage and records it. Runs inside the
// caller's transaction; if the insert fails the stored file is removed.
async function saveDocument(client, { file, docType, title, linkedType, linkedId, confidentiality, source, uploadedBy, signatureStatus = "Not required", replaces = null, templateId = null }) {
  const key = `${linkedType}/${linkedId}/${crypto.randomUUID()}-${safeName(file.originalname)}`;
  await putFile(key, file.buffer, file.mimetype);
  try {
    const { rows } = await client.query(
      `INSERT INTO documents (doc_type, title, linked_type, linked_id, filename, mime_type, size_bytes, sha256, storage_key,
         version, replaces_document_id, confidentiality, signature_status, source, uploaded_by, template_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [
        docType, title, linkedType, linkedId, file.originalname.slice(0, 255), file.mimetype, file.size,
        crypto.createHash("sha256").update(file.buffer).digest("hex"), key,
        replaces ? replaces.version + 1 : 1, replaces ? replaces.id : null,
        confidentiality, signatureStatus, source, uploadedBy, templateId,
      ]
    );
    return rows[0];
  } catch (err) {
    await deleteFile(key);
    throw err;
  }
}

// Who may open a document (PRD 9.1):
//   admin    - everything, but Restricted and KYC documents need
//              restricted_access; voided documents only for admins
//   investor - their own KYC uploads, their investor's and commitments'
//              documents marked "Shareable with investor", and teasers of
//              vehicles they can see
//   partner  - their own partner documents marked "Shareable with partner",
//              and teasers of vehicles they can see
async function canAccessDocument(db, user, doc) {
  const kycDoc = doc.linked_type === "kyc_item" || doc.linked_type === "kyc_ubo";
  if (user.role === "admin") {
    return doc.confidentiality === "Restricted" || kycDoc ? hasRestrictedAccess(user.id) : true;
  }
  if (doc.voided_at) return false;
  if (user.role === "investor") {
    const { rows } = await db.query("SELECT investor_id FROM investor_contacts WHERE user_id = $1", [user.id]);
    const investorId = rows[0]?.investor_id;
    if (!investorId) return false;
    if (doc.linked_type === "investor") return doc.linked_id === investorId && doc.confidentiality === "Shareable with investor";
    if (doc.linked_type === "commitment") {
      if (doc.confidentiality !== "Shareable with investor") return false;
      const { rows: own } = await db.query("SELECT 1 FROM commitments WHERE id = $1 AND investor_id = $2", [doc.linked_id, investorId]);
      return Boolean(own[0]);
    }
    if (doc.linked_type === "vehicle") return doc.doc_type === "Teaser" && isVisible(db, "investor", doc.linked_id, investorId);
    if (doc.linked_type === "kyc_item") {
      const { rows: own } = await db.query(
        "SELECT 1 FROM kyc_items it JOIN kyc_files f ON f.id = it.kyc_file_id WHERE it.id = $1 AND f.investor_id = $2",
        [doc.linked_id, investorId]
      );
      return Boolean(own[0]);
    }
    return false;
  }
  if (user.role === "partner") {
    if (doc.linked_type === "vehicle") return doc.doc_type === "Teaser" && isVisible(db, "partner", doc.linked_id);
    if (doc.linked_type !== "partner" || doc.confidentiality !== "Shareable with partner") return false;
    const { rows } = await db.query("SELECT 1 FROM venture_partners WHERE id = $1 AND user_id = $2", [doc.linked_id, user.id]);
    return Boolean(rows[0]);
  }
  return false;
}

module.exports = { receiveFile, saveDocument, canAccessDocument, MAX_BYTES };
