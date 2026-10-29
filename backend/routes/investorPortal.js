// Investor's own screens for M2: their KYC checklist and shared documents
// (PRD 6.14). Mounted at /api/investor; investor role only. Investors never
// see reviewer notes beyond what's addressed to them, screening results,
// risk rating or classification.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireRole } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const { investorForUser } = require("../lib/identity.js");
const { receiveFile, saveDocument } = require("../lib/documents.js");
const { logAudit } = require("../lib/audit.js");

const router = Router();
router.use(requireAuth, requireRole("investor"));

const INVESTOR_CAN_UPLOAD = ["Open", "Information requested"];

router.get("/me", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  res.json({ investor: { id: inv.id, name: inv.display_name || inv.legal_name, kind: inv.kind, company: inv.company } });
}));

router.get("/kyc", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  const { rows } = await pool.query(
    `SELECT id, kyc_type, status, refresh_due, submitted_at, decided_at,
            CASE WHEN status = 'Information requested' THEN decision_note END AS request_note,
            (status = 'Cleared' AND refresh_due < current_date) AS expired
     FROM kyc_files WHERE investor_id = $1 AND is_current`,
    [inv.id]
  );
  const file = rows[0];
  if (!file) return res.json({ file: null, items: [] });
  const { rows: items } = await pool.query(
    `SELECT id, label, description, required, status, CASE WHEN status = 'Rejected' THEN review_note END AS review_note
     FROM kyc_items WHERE kyc_file_id = $1 ORDER BY sort_order, id`,
    [file.id]
  );
  const { rows: docs } = await pool.query(
    `SELECT id, linked_id, filename, uploaded_at FROM documents
     WHERE linked_type = 'kyc_item' AND linked_id = ANY($1) AND voided_at IS NULL ORDER BY uploaded_at DESC`,
    [items.map((i) => i.id)]
  );
  res.json({
    file: { ...file, can_upload: INVESTOR_CAN_UPLOAD.includes(file.status) },
    items: items.map((it) => ({ ...it, documents: docs.filter((d) => d.linked_id === it.id) })),
  });
}));

router.post("/kyc/items/:itemId/upload", receiveFile, asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  const itemId = v.id(req.params.itemId, "item");
  const document = await inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT it.*, f.status AS file_status FROM kyc_items it JOIN kyc_files f ON f.id = it.kyc_file_id
       WHERE it.id = $1 AND f.investor_id = $2 AND f.is_current FOR UPDATE OF f`,
      [itemId, inv.id]
    );
    const item = rows[0];
    if (!item) throw httpError(404, "Checklist item not found.");
    if (!INVESTOR_CAN_UPLOAD.includes(item.file_status)) throw httpError(400, "Your KYC is with RIV for review, so uploads are paused.");
    if (item.status === "Verified") throw httpError(400, "RIV has already verified this item.");
    const doc = await saveDocument(client, {
      file: req.file, docType: "KYC document", title: item.label, linkedType: "kyc_item", linkedId: itemId,
      confidentiality: "Restricted", source: "Investor upload", uploadedBy: req.user.id,
    });
    await client.query("UPDATE kyc_items SET status = 'Received', review_note = NULL WHERE id = $1", [itemId]);
    await logAudit({ actorId: req.user.id, action: "kyc.document_uploaded", objectType: "kyc_file", objectId: item.kyc_file_id, details: { item: item.label, source: "Investor upload" }, req }, client);
    return { id: doc.id, filename: doc.filename, uploaded_at: doc.uploaded_at };
  });
  res.status(201).json({ document });
}));

// Hand the checklist to RIV for review once every required item has a file.
router.post("/kyc/submit", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  const file = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM kyc_files WHERE investor_id = $1 AND is_current FOR UPDATE", [inv.id]);
    const f = rows[0];
    if (!f) throw httpError(404, "RIV hasn't opened your KYC checklist yet.");
    if (!INVESTOR_CAN_UPLOAD.includes(f.status)) throw httpError(400, "Your KYC has already been submitted.");
    const { rows: missing } = await client.query(
      "SELECT label FROM kyc_items WHERE kyc_file_id = $1 AND required AND status NOT IN ('Received', 'Verified') ORDER BY sort_order",
      [f.id]
    );
    if (missing.length) throw httpError(400, `Upload these first: ${missing.map((m) => m.label).join(", ")}.`);
    const { rows: updated } = await client.query(
      "UPDATE kyc_files SET status = 'Submitted', submitted_at = now(), updated_at = now() WHERE id = $1 RETURNING id, status, submitted_at",
      [f.id]
    );
    await logAudit({ actorId: req.user.id, action: "kyc.submitted", objectType: "investor", objectId: inv.id, details: { kyc_file: f.id }, req }, client);
    return updated[0];
  });
  res.json({ file });
}));

// Documents RIV has shared with this investor.
router.get("/documents", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  const { rows } = await pool.query(
    `SELECT id, doc_type, title, filename, signature_status, version, uploaded_at FROM documents
     WHERE linked_type = 'investor' AND linked_id = $1 AND confidentiality = 'Shareable with investor' AND voided_at IS NULL
     ORDER BY uploaded_at DESC`,
    [inv.id]
  );
  res.json({ documents: rows });
}));

module.exports = router;
