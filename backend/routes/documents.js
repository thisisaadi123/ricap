// Document vault (PRD 8.7) and secure downloads (PRD 9.2).
//   /api/documents/:id/link   any signed-in user, if allowed to see it
//   /api/files/:token         streams a local-storage file for a valid
//                             60-second token (no session needed)
//   /api/admin/documents/...  admin: upload, signature status, new version, void
const express = require("express");
const fs = require("fs");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const C = require("../lib/constants.js");
const { logAudit } = require("../lib/audit.js");
const { receiveFile, saveDocument, canAccessDocument } = require("../lib/documents.js");
const { downloadUrl, readFileToken, localPath, driverName } = require("../lib/storage.js");
const { hasRestrictedAccess } = require("../lib/identity.js");

const linkRouter = express.Router();
const fileRouter = express.Router();
const adminRouter = express.Router();

linkRouter.get("/:id/link", requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM documents WHERE id = $1", [v.id(req.params.id, "document")]);
  const doc = rows[0];
  if (!doc || !(await canAccessDocument(pool, req.user, doc))) throw httpError(404, "Document not found.");
  // Every open of a restricted or KYC document is logged (PRD 9.2).
  if (doc.confidentiality === "Restricted" || doc.linked_type.startsWith("kyc_")) {
    await logAudit({ actorId: req.user.id, action: "document.viewed", objectType: "document", objectId: doc.id, details: { title: doc.title }, req });
  }
  res.json({ url: await downloadUrl(doc.storage_key, doc.filename), filename: doc.filename });
}));

fileRouter.get("/:token", (req, res) => {
  if (driverName() !== "local") return res.status(404).end();
  let data = null;
  try { data = readFileToken(req.params.token); } catch {}
  if (!data) return res.status(410).type("text").send("This download link has expired. Go back and open the document again.");
  let full;
  try { full = localPath(data.key); } catch { return res.status(404).end(); }
  if (!fs.existsSync(full)) return res.status(404).type("text").send("File not found.");
  res.setHeader("Cache-Control", "no-store");
  res.download(full, data.filename);
});

// ---------- admin ----------
adminRouter.use(requireAuth, requireAdmin);

const LINKABLE = { investor: "investors", partner: "venture_partners" };

async function assertCanTouch(userId, doc) {
  if ((doc.confidentiality === "Restricted" || doc.linked_type.startsWith("kyc_")) && !(await hasRestrictedAccess(userId))) {
    throw httpError(403, "This document needs restricted access.");
  }
}

// Upload a document to an investor or partner record.
adminRouter.post("/", receiveFile, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const linkedType = v.oneOf(b.linked_type, Object.keys(LINKABLE), "Linked to", { required: true });
  const linkedId = v.id(b.linked_id, "record");
  const docType = v.oneOf(b.doc_type, C.DOC_TYPES, "Document type", { required: true });
  const confidentiality = v.oneOf(b.confidentiality || "Internal", C.CONFIDENTIALITY, "Confidentiality", { required: true });
  const signatureStatus = v.oneOf(b.signature_status || "Not required", C.SIGNATURE_STATUSES, "Signature status", { required: true });
  const source = v.oneOf(b.source || "Admin upload", C.DOC_SOURCES.filter((s) => s !== "Investor upload"), "Source", { required: true });
  const title = v.text(b.title, "Title", { max: 300 }) || req.file.originalname;
  if (confidentiality === "Shareable with partner" && linkedType !== "partner") throw httpError(400, "Only partner documents can be shared with a partner.");
  if (confidentiality === "Shareable with investor" && linkedType !== "investor") throw httpError(400, "Only investor documents can be shared with an investor.");
  if (confidentiality === "Restricted" && !(await hasRestrictedAccess(req.user.id))) throw httpError(403, "Restricted documents need restricted access.");

  const document = await inTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT id FROM ${LINKABLE[linkedType]} WHERE id = $1`, [linkedId]);
    if (!rows[0]) throw httpError(404, `That ${linkedType} doesn't exist.`);
    const doc = await saveDocument(client, {
      file: req.file, docType, title, linkedType, linkedId, confidentiality, source, uploadedBy: req.user.id, signatureStatus,
    });
    await logAudit({ actorId: req.user.id, action: "document.uploaded", objectType: linkedType, objectId: linkedId, details: { title, doc_type: docType }, req }, client);
    return doc;
  });
  res.status(201).json({ document });
}));

adminRouter.get("/", asyncRoute(async (req, res) => {
  const linkedType = v.oneOf(req.query.linked_type, Object.keys(LINKABLE), "Linked to", { required: true });
  const linkedId = v.id(req.query.linked_id, "record");
  const restricted = await hasRestrictedAccess(req.user.id);
  const { rows } = await pool.query(
    `SELECT d.id, d.doc_type, d.title, d.filename, d.size_bytes, d.confidentiality, d.signature_status, d.zoho_envelope_id,
            d.source, d.version, d.replaces_document_id, d.uploaded_at, d.voided_at, d.void_reason, u.name AS uploaded_by_name
     FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.linked_type = $1 AND d.linked_id = $2 AND ($3 OR d.confidentiality <> 'Restricted')
     ORDER BY d.uploaded_at DESC`,
    [linkedType, linkedId, restricted]
  );
  res.json({ documents: rows });
}));

// Signature tracking (manual until Zoho Sign is connected), title and
// confidentiality.
adminRouter.patch("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "document");
  const b = req.body || {};
  const fields = {};
  if (b.signature_status !== undefined) fields.signature_status = v.oneOf(b.signature_status, C.SIGNATURE_STATUSES, "Signature status", { required: true });
  if (b.zoho_envelope_id !== undefined) fields.zoho_envelope_id = v.text(b.zoho_envelope_id, "Zoho Sign envelope ID", { max: 200 });
  if (b.title !== undefined) fields.title = v.text(b.title, "Title", { required: true, max: 300 });
  if (b.confidentiality !== undefined) fields.confidentiality = v.oneOf(b.confidentiality, C.CONFIDENTIALITY, "Confidentiality", { required: true });
  const document = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM documents WHERE id = $1 FOR UPDATE", [id]);
    const doc = rows[0];
    if (!doc) throw httpError(404, "Document not found.");
    await assertCanTouch(req.user.id, { ...doc, ...fields });
    if (doc.voided_at) throw httpError(400, "This document is voided.");
    if (doc.linked_type.startsWith("kyc_") && fields.confidentiality && fields.confidentiality !== "Restricted") throw httpError(400, "KYC documents always stay restricted.");
    const cols = Object.keys(fields);
    if (!cols.length) return doc;
    const { rows: updated } = await client.query(
      `UPDATE documents SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`,
      [id, ...cols.map((c) => fields[c])]
    );
    await logAudit({ actorId: req.user.id, action: "document.updated", objectType: "document", objectId: id, details: Object.fromEntries(cols.map((c) => [c, fields[c]])), req }, client);
    return updated[0];
  });
  res.json({ document });
}));

// Upload a newer version, e.g. the signed copy of a draft. The old version
// stays on record.
adminRouter.post("/:id/version", receiveFile, asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "document");
  const signatureStatus = v.oneOf(req.body?.signature_status || "Not required", C.SIGNATURE_STATUSES, "Signature status", { required: true });
  const document = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM documents WHERE id = $1 FOR UPDATE", [id]);
    const old = rows[0];
    if (!old) throw httpError(404, "Document not found.");
    await assertCanTouch(req.user.id, old);
    if (old.voided_at) throw httpError(400, "This document is voided.");
    if (!LINKABLE[old.linked_type]) throw httpError(400, "Upload KYC files from the KYC checklist instead.");
    const doc = await saveDocument(client, {
      file: req.file, docType: old.doc_type, title: old.title, linkedType: old.linked_type, linkedId: old.linked_id,
      confidentiality: old.confidentiality, source: "Admin upload", uploadedBy: req.user.id, signatureStatus, replaces: old,
    });
    await logAudit({ actorId: req.user.id, action: "document.new_version", objectType: "document", objectId: doc.id, details: { title: old.title, version: doc.version }, req }, client);
    return doc;
  });
  res.status(201).json({ document });
}));

// Documents are never deleted, only voided with a reason (PRD 7).
adminRouter.post("/:id/void", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "document");
  const reason = v.text(req.body?.reason, "Reason", { required: true, max: 1000 });
  const document = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM documents WHERE id = $1 FOR UPDATE", [id]);
    const doc = rows[0];
    if (!doc) throw httpError(404, "Document not found.");
    await assertCanTouch(req.user.id, doc);
    if (doc.voided_at) throw httpError(400, "Already voided.");
    const { rows: updated } = await client.query(
      "UPDATE documents SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1 RETURNING *",
      [id, req.user.id, reason]
    );
    // A voided KYC upload no longer counts towards its checklist item.
    if (doc.linked_type === "kyc_item") {
      await client.query(
        `UPDATE kyc_items SET status = 'Requested' WHERE id = $1 AND status IN ('Received', 'Verified')
           AND NOT EXISTS (SELECT 1 FROM documents WHERE linked_type = 'kyc_item' AND linked_id = $1 AND voided_at IS NULL)`,
        [doc.linked_id]
      );
    }
    await logAudit({ actorId: req.user.id, action: "document.voided", objectType: "document", objectId: id, details: { title: doc.title, reason }, req }, client);
    return updated[0];
  });
  res.json({ document });
}));

module.exports = { linkRouter, fileRouter, adminRouter };
