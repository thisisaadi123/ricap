// Configuration that counsel (Novo Juris) supplies (LEG-4, LEG-6): the KYC
// checklists and the agreement templates. Mounted at /api/admin/templates;
// admin only.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const C = require("../lib/constants.js");
const { logAudit } = require("../lib/audit.js");
const { receiveFile, saveDocument } = require("../lib/documents.js");

const router = Router();
router.use(requireAuth, requireAdmin);

// ---------- KYC checklist ----------
// Changes apply to KYC files opened from now on; files already open keep
// the items they started with.
router.get("/kyc-checklist", asyncRoute(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM kyc_checklist_templates ORDER BY kyc_type DESC, sort_order, id");
  res.json({ items: rows });
}));

function readChecklistItem(b, { partial }) {
  const out = {};
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(b, k);
  if (has("kyc_type")) out.kyc_type = v.oneOf(b.kyc_type, C.INVESTOR_KINDS, "Investor kind", { required: true });
  if (has("label")) out.label = v.text(b.label, "Item", { required: true, max: 300 });
  if (has("description")) out.description = v.text(b.description, "Description", { max: 1000 });
  if (has("required")) out.required = v.bool(b.required);
  if (has("sort_order")) out.sort_order = v.number(b.sort_order, "Order", { min: 0, max: 100000, integer: true }) ?? 0;
  if (has("active")) out.active = b.active === undefined ? true : v.bool(b.active);
  return out;
}

router.post("/kyc-checklist", asyncRoute(async (req, res) => {
  const item = readChecklistItem(req.body || {}, { partial: false });
  const cols = Object.keys(item);
  const { rows } = await pool.query(
    `INSERT INTO kyc_checklist_templates (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    cols.map((c) => item[c])
  );
  await logAudit({ actorId: req.user.id, action: "kyc_checklist.item_added", objectType: "kyc_checklist", objectId: rows[0].id, details: { kyc_type: item.kyc_type, label: item.label }, req });
  res.status(201).json({ item: rows[0] });
}));

router.patch("/kyc-checklist/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "item");
  const changes = readChecklistItem(req.body || {}, { partial: true });
  delete changes.kyc_type;
  const cols = Object.keys(changes);
  if (!cols.length) throw httpError(400, "Nothing to change.");
  const { rows } = await pool.query(
    `UPDATE kyc_checklist_templates SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => changes[c])]
  );
  if (!rows[0]) throw httpError(404, "Checklist item not found.");
  await logAudit({ actorId: req.user.id, action: "kyc_checklist.item_updated", objectType: "kyc_checklist", objectId: id, details: { fields: cols.join(", ") }, req });
  res.json({ item: rows[0] });
}));

// ---------- agreement templates ----------
router.get("/documents", asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, d.id AS document_id, d.filename, d.size_bytes, u.name AS created_by_name
     FROM document_templates t
     LEFT JOIN LATERAL (SELECT * FROM documents WHERE linked_type = 'template' AND linked_id = t.id AND voided_at IS NULL
                        ORDER BY uploaded_at DESC LIMIT 1) d ON true
     LEFT JOIN users u ON u.id = t.created_by
     ORDER BY t.status = 'Retired', t.name, t.created_at DESC`
  );
  res.json({ templates: rows });
}));

router.post("/documents", receiveFile, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const name = v.text(b.name, "Template name", { required: true, max: 200 });
  const docType = v.oneOf(b.doc_type, C.DOC_TYPES, "Document type", { required: true });
  const versionLabel = v.text(b.version_label, "Version", { required: true, max: 50 });
  const notes = v.text(b.notes, "Notes", { max: 2000 });
  const template = await inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      "INSERT INTO document_templates (name, doc_type, version_label, notes, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, docType, versionLabel, notes, req.user.id]
    );
    await saveDocument(client, {
      file: req.file, docType, title: `${name} (${versionLabel})`, linkedType: "template", linkedId: rows[0].id,
      confidentiality: "Internal", source: "Admin upload", uploadedBy: req.user.id, templateId: rows[0].id,
    });
    await logAudit({ actorId: req.user.id, action: "template.added", objectType: "template", objectId: rows[0].id, details: { name, version: versionLabel }, req }, client);
    return rows[0];
  });
  res.status(201).json({ template });
}));

// Draft -> Active -> Retired. Activating one version of a template name
// retires the previously active one, so only one version is in use.
router.patch("/documents/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "template");
  const status = v.oneOf(req.body?.status, C.TEMPLATE_STATUSES, "Status", { required: true });
  const template = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM document_templates WHERE id = $1 FOR UPDATE", [id]);
    if (!rows[0]) throw httpError(404, "Template not found.");
    if (status === "Active") {
      await client.query("UPDATE document_templates SET status = 'Retired', updated_at = now() WHERE name = $1 AND status = 'Active' AND id <> $2", [rows[0].name, id]);
    }
    const { rows: updated } = await client.query("UPDATE document_templates SET status = $2, updated_at = now() WHERE id = $1 RETURNING *", [id, status]);
    await logAudit({ actorId: req.user.id, action: "template.status_changed", objectType: "template", objectId: id, details: { status }, req }, client);
    return updated[0];
  });
  res.json({ template });
}));

// ---------- stage evidence (PRD 7: document checklist per stage) ----------
const EVIDENCE_FLOWS = ["HoldCo", "Fund", "IB", "IB deal"];

router.get("/stage-requirements", asyncRoute(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM stage_requirements ORDER BY flow, stage, sort_order, id");
  res.json({ requirements: rows });
}));

router.post("/stage-requirements", asyncRoute(async (req, res) => {
  const b = req.body || {};
  const flow = v.oneOf(b.flow, EVIDENCE_FLOWS, "Flow", { required: true });
  const stage = v.text(b.stage, "Stage", { required: true, max: 60 });
  const label = v.text(b.label, "What's needed", { required: true, max: 200 });
  const docType = v.oneOf(b.doc_type, C.DOC_TYPES, "Document type", { required: true });
  const { rows } = await pool.query(
    `INSERT INTO stage_requirements (flow, stage, label, doc_type, sort_order)
     VALUES ($1, $2, $3, $4, (SELECT coalesce(max(sort_order), 0) + 10 FROM stage_requirements WHERE flow = $1 AND stage = $2)) RETURNING *`,
    [flow, stage, label, docType]
  );
  await logAudit({ actorId: req.user.id, action: "stage_requirement.added", objectType: "stage_requirement", objectId: rows[0].id, details: { flow, stage, label }, req });
  res.status(201).json({ requirement: rows[0] });
}));

router.patch("/stage-requirements/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "requirement");
  const required = v.bool(req.body?.required);
  const { rows } = await pool.query("UPDATE stage_requirements SET required = $2 WHERE id = $1 RETURNING *", [id, required]);
  if (!rows[0]) throw httpError(404, "Requirement not found.");
  await logAudit({ actorId: req.user.id, action: "stage_requirement.updated", objectType: "stage_requirement", objectId: id, details: { required }, req });
  res.json({ requirement: rows[0] });
}));

module.exports = router;
