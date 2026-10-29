// KYC review (PRD 6.4, 8.3). In v1 RIV admins do the compliance work
// (LEG-5). Mounted at /api/admin/kyc; admin with restricted access only.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { requireRestricted } = require("../lib/identity.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const C = require("../lib/constants.js");
const { logAudit } = require("../lib/audit.js");
const { receiveFile, saveDocument } = require("../lib/documents.js");
const { emailInvestorUsers } = require("../lib/notify.js");

const router = Router();
router.use(requireAuth, requireAdmin, requireRestricted());

const OPEN_STATUSES = ["Open", "Submitted", "Information requested"];

async function loadFile(db, fileId, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT f.*, coalesce(i.display_name, i.legal_name) AS investor_name, i.kind AS investor_kind, i.registration_status
     FROM kyc_files f JOIN investors i ON i.id = f.investor_id WHERE f.id = $1 ${lock ? "FOR UPDATE OF f" : ""}`,
    [fileId]
  );
  if (!rows[0]) throw httpError(404, "KYC file not found.");
  return rows[0];
}

function assertEditable(file) {
  if (!file.is_current) throw httpError(400, "This is an old KYC file. Open the current one.");
  if (!OPEN_STATUSES.includes(file.status)) throw httpError(400, `This KYC file is ${file.status.toLowerCase()} and can't be changed. Open a refresh instead.`);
}

// Queue of current KYC files (PRD 6.11 compliance view).
router.get("/", asyncRoute(async (req, res) => {
  const params = [];
  let filter = "";
  const status = req.query.status ? v.oneOf(req.query.status, [...C.KYC_FILE_STATUSES, "Expired"], "Status") : null;
  if (status === "Expired") {
    filter = "AND f.status = 'Cleared' AND f.refresh_due < current_date";
  } else if (status) {
    params.push(status);
    filter = "AND f.status = $1 AND NOT (f.status = 'Cleared' AND coalesce(f.refresh_due, current_date) < current_date)";
  }
  const { rows } = await pool.query(
    `SELECT f.id, f.investor_id, f.kyc_type, f.status, f.risk_rating, f.refresh_due, f.submitted_at, f.created_at, f.decided_at,
            (f.status = 'Cleared' AND f.refresh_due < current_date) AS expired,
            coalesce(i.display_name, i.legal_name) AS investor_name, i.category,
            count(it.id) FILTER (WHERE it.required)::int AS required_count,
            count(it.id) FILTER (WHERE it.required AND it.status = 'Verified')::int AS verified_count,
            count(it.id) FILTER (WHERE it.status = 'Received')::int AS to_review_count
     FROM kyc_files f
     JOIN investors i ON i.id = f.investor_id
     LEFT JOIN kyc_items it ON it.kyc_file_id = f.id
     WHERE f.is_current ${filter}
     GROUP BY f.id, i.id
     ORDER BY CASE f.status WHEN 'Submitted' THEN 0 WHEN 'Open' THEN 1 WHEN 'Information requested' THEN 2 ELSE 3 END, f.created_at`,
    params
  );
  res.json({ files: rows });
}));

// Open a KYC file for an approved investor, or a refresh of a decided one.
router.post("/open", asyncRoute(async (req, res) => {
  const investorId = v.id(req.body?.investor_id, "investor");
  const file = await inTransaction(pool, async (client) => {
    const { rows: inv } = await client.query("SELECT id, kind, registration_status FROM investors WHERE id = $1 FOR UPDATE", [investorId]);
    if (!inv[0]) throw httpError(404, "Investor not found.");
    if (inv[0].registration_status !== "Approved") throw httpError(400, "Approve the investor before starting KYC.");
    const { rows: current } = await client.query("SELECT id, status FROM kyc_files WHERE investor_id = $1 AND is_current", [investorId]);
    if (current[0] && OPEN_STATUSES.includes(current[0].status)) throw httpError(400, "This investor already has a KYC file in progress.");
    if (current[0]) await client.query("UPDATE kyc_files SET is_current = false, updated_at = now() WHERE id = $1", [current[0].id]);

    const { rows: created } = await client.query(
      "INSERT INTO kyc_files (investor_id, kyc_type, opened_by) VALUES ($1, $2, $3) RETURNING *",
      [investorId, inv[0].kind, req.user.id]
    );
    await client.query(
      `INSERT INTO kyc_items (kyc_file_id, template_id, label, description, required, sort_order)
       SELECT $1, id, label, description, required, sort_order FROM kyc_checklist_templates
       WHERE kyc_type = $2 AND active ORDER BY sort_order`,
      [created[0].id, inv[0].kind]
    );
    await logAudit({ actorId: req.user.id, action: current[0] ? "kyc.refresh_opened" : "kyc.opened", objectType: "investor", objectId: investorId, details: { kyc_file: created[0].id }, req }, client);
    return created[0];
  });
  await emailInvestorUsers(investorId, "Your RICap KYC checklist is ready", "RIV has opened your KYC checklist. Please sign in to RICap and upload the documents listed under KYC.");
  res.status(201).json({ file });
}));

router.get("/:id", asyncRoute(async (req, res) => {
  const file = await loadFile(pool, v.id(req.params.id));
  const { rows: items } = await pool.query(
    `SELECT it.*, u.name AS reviewed_by_name FROM kyc_items it LEFT JOIN users u ON u.id = it.reviewed_by
     WHERE it.kyc_file_id = $1 ORDER BY it.sort_order, it.id`,
    [file.id]
  );
  const { rows: docs } = await pool.query(
    `SELECT d.id, d.linked_id, d.filename, d.size_bytes, d.source, d.uploaded_at, d.voided_at, u.name AS uploaded_by_name
     FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.linked_type = 'kyc_item' AND d.linked_id = ANY($1) ORDER BY d.uploaded_at DESC`,
    [items.map((i) => i.id)]
  );
  const { rows: ubos } = await pool.query("SELECT * FROM kyc_ubos WHERE kyc_file_id = $1 ORDER BY id", [file.id]);
  const { rows: history } = await pool.query(
    "SELECT id, status, decided_at, refresh_due, created_at FROM kyc_files WHERE investor_id = $1 AND id <> $2 ORDER BY created_at DESC",
    [file.investor_id, file.id]
  );
  res.json({
    file,
    items: items.map((it) => ({ ...it, documents: docs.filter((d) => d.linked_id === it.id) })),
    ubos,
    history,
  });
}));

// Screening, source of funds, risk and classification (PRD 6.4 step 3).
router.patch("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const b = req.body || {};
  const fields = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  if (has("pep_status")) fields.pep_status = v.oneOf(b.pep_status, C.PEP_STATUSES, "PEP status");
  if (has("sanctions_result")) fields.sanctions_result = v.oneOf(b.sanctions_result, C.SANCTIONS_RESULTS, "Sanctions result");
  if (has("sanctions_checked_at")) fields.sanctions_checked_at = v.date(b.sanctions_checked_at, "Screening date");
  if (has("sanctions_method")) fields.sanctions_method = v.text(b.sanctions_method, "Screening method", { max: 500 });
  if (has("source_of_funds")) fields.source_of_funds = v.text(b.source_of_funds, "Source of funds / wealth", { max: 4000 });
  if (has("tax_self_cert")) fields.tax_self_cert = v.bool(b.tax_self_cert);
  if (has("risk_rating")) fields.risk_rating = v.oneOf(b.risk_rating, C.RISK_RATINGS, "Risk rating");
  if (has("classification")) fields.classification = v.oneOf(b.classification, C.CLASSIFICATIONS, "Classification");
  const file = await inTransaction(pool, async (client) => {
    assertEditable(await loadFile(client, id, { lock: true }));
    const cols = Object.keys(fields);
    if (!cols.length) return loadFile(client, id);
    const { rows } = await client.query(
      `UPDATE kyc_files SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...cols.map((c) => fields[c])]
    );
    await logAudit({ actorId: req.user.id, action: "kyc.updated", objectType: "kyc_file", objectId: id, details: { fields: cols.join(", ") }, req }, client);
    return rows[0];
  });
  res.json({ file });
}));

// Extra checklist item for this investor only (e.g. something counsel asked for).
router.post("/:id/items", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const label = v.text(req.body?.label, "Item", { required: true, max: 300 });
  const description = v.text(req.body?.description, "Description", { max: 1000 });
  const item = await inTransaction(pool, async (client) => {
    assertEditable(await loadFile(client, id, { lock: true }));
    const { rows } = await client.query(
      `INSERT INTO kyc_items (kyc_file_id, label, description, required, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT coalesce(max(sort_order), 0) + 10 FROM kyc_items WHERE kyc_file_id = $1)) RETURNING *`,
      [id, label, description, req.body?.required !== false]
    );
    await logAudit({ actorId: req.user.id, action: "kyc.item_added", objectType: "kyc_file", objectId: id, details: { item: label }, req }, client);
    return rows[0];
  });
  res.status(201).json({ item });
}));

// Admin uploads a document received by email or in person (PRD 6.4 step 2).
router.post("/:id/items/:itemId/upload", receiveFile, asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const itemId = v.id(req.params.itemId, "item");
  const source = v.oneOf(req.body?.source || "Received by email", ["Received by email", "Received in person", "Admin upload"], "Source", { required: true });
  const document = await inTransaction(pool, async (client) => {
    assertEditable(await loadFile(client, id, { lock: true }));
    const { rows } = await client.query("SELECT * FROM kyc_items WHERE id = $1 AND kyc_file_id = $2", [itemId, id]);
    if (!rows[0]) throw httpError(404, "Checklist item not found.");
    const doc = await saveDocument(client, {
      file: req.file, docType: "KYC document", title: rows[0].label, linkedType: "kyc_item", linkedId: itemId,
      confidentiality: "Restricted", source, uploadedBy: req.user.id,
    });
    if (rows[0].status !== "Verified") {
      await client.query("UPDATE kyc_items SET status = 'Received', review_note = NULL WHERE id = $1", [itemId]);
    }
    await logAudit({ actorId: req.user.id, action: "kyc.document_uploaded", objectType: "kyc_file", objectId: id, details: { item: rows[0].label, source }, req }, client);
    return doc;
  });
  res.status(201).json({ document });
}));

router.post("/:id/items/:itemId/review", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const itemId = v.id(req.params.itemId, "item");
  const status = v.oneOf(req.body?.status, ["Verified", "Rejected"], "Decision", { required: true });
  const note = v.text(req.body?.note, "Note", { max: 1000 });
  if (status === "Rejected" && !note) throw httpError(400, "Tell the investor what's wrong with this document.");
  const item = await inTransaction(pool, async (client) => {
    assertEditable(await loadFile(client, id, { lock: true }));
    const { rows: docs } = await client.query(
      "SELECT 1 FROM documents WHERE linked_type = 'kyc_item' AND linked_id = $1 AND voided_at IS NULL", [itemId]
    );
    if (status === "Verified" && !docs[0]) throw httpError(400, "There's no document to verify for this item yet.");
    const { rows } = await client.query(
      `UPDATE kyc_items SET status = $3, review_note = $4, reviewed_by = $5, reviewed_at = now()
       WHERE id = $1 AND kyc_file_id = $2 RETURNING *`,
      [itemId, id, status, note, req.user.id]
    );
    if (!rows[0]) throw httpError(404, "Checklist item not found.");
    await logAudit({ actorId: req.user.id, action: status === "Verified" ? "kyc.item_verified" : "kyc.item_rejected", objectType: "kyc_file", objectId: id, details: { item: rows[0].label, ...(note ? { note } : {}) }, req }, client);
    return rows[0];
  });
  res.json({ item });
}));

router.post("/:id/ubos", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const name = v.text(req.body?.name, "Owner name", { required: true, max: 200 });
  const pct = v.number(req.body?.ownership_pct, "Ownership %", { min: 0, max: 100 });
  const nationality = v.text(req.body?.nationality, "Nationality", { max: 100 });
  const ubo = await inTransaction(pool, async (client) => {
    const file = await loadFile(client, id, { lock: true });
    assertEditable(file);
    if (file.kyc_type !== "Entity") throw httpError(400, "Beneficial owners only apply to entity investors.");
    const { rows } = await client.query(
      "INSERT INTO kyc_ubos (kyc_file_id, name, ownership_pct, nationality) VALUES ($1, $2, $3, $4) RETURNING *",
      [id, name, pct, nationality]
    );
    await logAudit({ actorId: req.user.id, action: "kyc.ubo_added", objectType: "kyc_file", objectId: id, details: { name }, req }, client);
    return rows[0];
  });
  res.status(201).json({ ubo });
}));

router.delete("/:id/ubos/:uboId", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const uboId = v.id(req.params.uboId, "owner");
  await inTransaction(pool, async (client) => {
    assertEditable(await loadFile(client, id, { lock: true }));
    const { rows } = await client.query("DELETE FROM kyc_ubos WHERE id = $1 AND kyc_file_id = $2 RETURNING name", [uboId, id]);
    if (!rows[0]) throw httpError(404, "Owner not found.");
    await logAudit({ actorId: req.user.id, action: "kyc.ubo_removed", objectType: "kyc_file", objectId: id, details: { name: rows[0].name }, req }, client);
  });
  res.json({ ok: true });
}));

// Final decision (PRD 6.4 step 4). Clearing needs every required item
// verified plus screening, risk and classification recorded.
router.post("/:id/decision", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const decision = v.oneOf(req.body?.decision, ["Cleared", "Information requested", "Rejected"], "Decision", { required: true });
  const note = v.text(req.body?.note, "Note", { max: 2000 });
  const refreshDue = v.date(req.body?.refresh_due, "Refresh date");
  if (decision !== "Cleared" && !note) throw httpError(400, decision === "Rejected" ? "Give a reason for rejecting." : "Tell the investor what's needed.");

  const file = await inTransaction(pool, async (client) => {
    const f = await loadFile(client, id, { lock: true });
    assertEditable(f);
    if (decision === "Cleared") {
      const { rows: open } = await client.query(
        "SELECT label FROM kyc_items WHERE kyc_file_id = $1 AND required AND status <> 'Verified' ORDER BY sort_order", [id]
      );
      const missing = [];
      if (open.length) missing.push(`verify ${open.map((o) => `"${o.label}"`).join(", ")}`);
      if (!f.pep_status) missing.push("record PEP status");
      if (!f.sanctions_result) missing.push("record the sanctions screening result");
      if (f.sanctions_result === "Confirmed match") missing.push("resolve the confirmed sanctions match (it can't be cleared)");
      if (!f.risk_rating) missing.push("set a risk rating");
      if (!f.classification) missing.push("classify the investor");
      if (f.kyc_type === "Entity") {
        const { rows: ubos } = await client.query("SELECT 1 FROM kyc_ubos WHERE kyc_file_id = $1", [id]);
        if (!ubos[0]) missing.push("add at least one beneficial owner");
      }
      if (missing.length) throw httpError(400, `Before clearing: ${missing.join("; ")}.`);
    }
    const { rows } = await client.query(
      `UPDATE kyc_files SET status = $2, decision_note = $3, decided_by = $4, decided_at = now(),
         refresh_due = CASE WHEN $2 = 'Cleared' THEN coalesce($5::date, (current_date + make_interval(months => $6))::date) ELSE refresh_due END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, decision, note, req.user.id, refreshDue, C.KYC_REFRESH_MONTHS]
    );
    await logAudit({ actorId: req.user.id, action: `kyc.${decision === "Cleared" ? "cleared" : decision === "Rejected" ? "rejected" : "info_requested"}`, objectType: "investor", objectId: f.investor_id, details: { kyc_file: id, ...(note ? { note } : {}) }, req }, client);
    return rows[0];
  });

  const messages = {
    "Cleared": "Your KYC has been reviewed and cleared. Thank you.",
    "Information requested": `RIV needs a little more for your KYC: ${note}\n\nPlease sign in and update your KYC checklist.`,
    "Rejected": "RIV has completed its review of your KYC. Please contact RIV for details.",
  };
  await emailInvestorUsers(file.investor_id, `RICap KYC update: ${decision}`, messages[decision]);
  res.json({ file });
}));

module.exports = router;
