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
const { visibleSql, isVisible } = require("../lib/visibility.js");
const E = require("../lib/commitments.js");
const { notifyAdmins } = require("../lib/notify.js");
const { statementFor } = require("../lib/statements.js");

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
    await notifyAdmins(client, { type: "kyc_admin", title: `KYC to review: ${inv.display_name || inv.legal_name}`, linkView: "kyc", linkId: f.id });
    return updated[0];
  });
  res.json({ file });
}));

// Documents RIV has shared with this investor.
router.get("/documents", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  const { rows } = await pool.query(
    `SELECT d.id, d.doc_type, d.title, d.filename, d.signature_status, d.version, d.uploaded_at, v.name AS vehicle_name
     FROM documents d
     LEFT JOIN commitments c ON d.linked_type = 'commitment' AND c.id = d.linked_id
     LEFT JOIN vehicles v ON v.id = c.vehicle_id
     WHERE d.confidentiality = 'Shareable with investor' AND d.voided_at IS NULL AND d.source <> 'Investor upload'
       AND ((d.linked_type = 'investor' AND d.linked_id = $1) OR (d.linked_type = 'commitment' AND c.investor_id = $1))
     ORDER BY d.uploaded_at DESC`,
    [inv.id]
  );
  res.json({ documents: rows });
}));

// ---------- M3: opportunities and my investments (PRD 6.14) ----------
router.get("/opportunities", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  const { rows } = await pool.query(
    `SELECT v.id, v.type, v.name, v.summary, v.target_raise, v.pre_money_valuation,
            CASE WHEN $2 = 'Individual' THEN v.min_ticket_individual ELSE v.min_ticket_entity END AS min_ticket,
            (SELECT c.id FROM commitments c WHERE c.vehicle_id = v.id AND c.investor_id = $1 AND c.status IN ('Active', 'On hold')) AS my_commitment_id,
            coalesce((SELECT json_agg(json_build_object('id', d.id, 'filename', d.filename, 'title', d.title) ORDER BY d.uploaded_at DESC)
                      FROM documents d WHERE d.linked_type = 'vehicle' AND d.linked_id = v.id AND d.doc_type = 'Teaser' AND d.voided_at IS NULL), '[]') AS teasers
     FROM vehicles v WHERE ${visibleSql("investor", 1)} ORDER BY v.id`,
    [inv.id, inv.kind]
  );
  res.json({ opportunities: rows });
}));

// "I'm interested" (PRD 6.14): creates an Intent for RIV to review.
router.post("/interest", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  const vehicleId = v.id(req.body?.vehicle_id, "opportunity");
  const amount = v.number(req.body?.indicative_amount, "Amount", { required: true, min: 1, max: 1e12 });
  const note = v.text(req.body?.note, "Note", { max: 2000 });
  if (!(await isVisible(pool, "investor", vehicleId, inv.id))) throw httpError(404, "That opportunity isn't open.");
  const id = await inTransaction(pool, (client) => E.createCommitment(client, {
    investorId: inv.id, vehicleId, amount, createdVia: "Investor portal", actorId: req.user.id, note, req,
  }));
  res.status(201).json({ commitment_id: id });
}));

function investorView(c, instruction) {
  return {
    id: c.id, flow: c.flow, stage: c.stage, status: c.status, vehicle_id: c.vehicle_id, vehicle_name: c.vehicle_name,
    indicative_amount: c.indicative_amount, committed_amount: c.committed_amount,
    received_total: c.received_total,
    // IB investors pay the startup directly, so that counts as paid too.
    outstanding: c.committed_amount ? Math.max(0, Number(c.committed_amount) - Number(c.received_total) - Number(c.funds_transferred_amount || 0)) : null,
    soft_confirmed_at: c.soft_confirmed_at, shares_issued: c.shares_issued, share_certificate_no: c.share_certificate_no,
    funds_transferred_amount: c.funds_transferred_amount,
    next_action: E.investorNextAction(c, { instruction }),
    action_needed: c.status === "Active" && Boolean(E.INVESTOR_ACTIONS[c.stage]) && !(c.flow === "HoldCo" && c.stage === "Funds due" && !instruction),
    created_at: c.created_at, updated_at: c.updated_at,
  };
}

async function ownCommitment(userId, id) {
  const inv = await investorForUser(userId);
  const c = await E.loadCommitment(pool, id);
  if (c.investor_id !== inv.id) throw httpError(404, "Commitment not found.");
  return c;
}

async function liveInstruction(commitmentId) {
  const { rows } = await pool.query("SELECT * FROM payment_instructions WHERE commitment_id = $1 AND voided_at IS NULL", [commitmentId]);
  return rows[0] || null;
}

router.get("/commitments", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  const { rows } = await pool.query("SELECT id FROM commitments WHERE investor_id = $1 ORDER BY updated_at DESC", [inv.id]);
  const out = [];
  for (const r of rows) {
    const c = await E.loadCommitment(pool, r.id);
    out.push(investorView(c, await liveInstruction(c.id)));
  }
  res.json({ commitments: out });
}));

router.get("/commitments/:id", asyncRoute(async (req, res) => {
  const c = await ownCommitment(req.user.id, v.id(req.params.id, "commitment"));
  const instruction = await liveInstruction(c.id);
  const { rows: documents } = await pool.query(
    `SELECT id, doc_type, title, filename, signature_status, version, source, uploaded_at FROM documents
     WHERE linked_type = 'commitment' AND linked_id = $1 AND confidentiality = 'Shareable with investor' AND voided_at IS NULL
     ORDER BY uploaded_at DESC`,
    [c.id]
  );
  const { rows: receipts } = await pool.query(
    `SELECT amount, value_date FROM money_movements
     WHERE commitment_id = $1 AND type = 'Subscription payment' AND voided_at IS NULL ORDER BY value_date`,
    [c.id]
  );
  // IB deals: deal facts, and the data room once RIV grants access.
  let deal = null;
  if (c.flow === "IB") {
    const { rows } = await pool.query(
      "SELECT startup_name, instrument, round_size, pre_money_valuation, data_room_url, deal_status FROM ib_deals WHERE vehicle_id = $1",
      [c.vehicle_id]
    );
    const d = rows[0];
    deal = d && {
      startup_name: d.startup_name, instrument: d.instrument, round_size: d.round_size, pre_money_valuation: d.pre_money_valuation, deal_status: d.deal_status,
      data_room_url: c.data_room_granted_at && c.status === "Active" && d.deal_status === "Live" ? d.data_room_url : null,
    };
  }
  res.json({
    commitment: investorView(c, instruction),
    deal,
    stages: E.FLOWS[c.flow],
    // Bank details only ever come from RIV's portal-issued instructions
    // (PRD 7); never by email.
    instruction: instruction && c.stage === "Funds due" && c.status === "Active" ? {
      amount: instruction.amount, due_date: instruction.due_date, reference: instruction.reference, legal_entity: instruction.legal_entity,
      bank_name: instruction.bank_name, bank_account_name: instruction.bank_account_name, bank_iban: instruction.bank_iban, bank_swift: instruction.bank_swift,
    } : null,
    documents,
    receipts,
  });
}));

router.post("/commitments/:id/confirm-soft", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  await ownCommitment(req.user.id, id);
  await inTransaction(pool, async (client) => {
    const c = await E.loadCommitment(client, id, { lock: true });
    if (c.flow !== "Fund" || c.stage !== "Soft commitment" || c.status !== "Active") throw httpError(400, "There's no soft commitment waiting for your confirmation.");
    await client.query("UPDATE commitments SET soft_confirmed_at = now(), soft_confirmation_method = 'Portal' WHERE id = $1", [id]);
    await E.advance(client, { ...c, soft_confirmed_at: new Date() }, { toStage: "Soft commitment confirmed", actorId: req.user.id, req, note: "Confirmed by the investor in the portal" });
  });
  res.json({ ok: true });
}));

// Investor uploads a payment confirmation or a signed copy. Neither moves
// anything on its own: a payment confirmation is not proof of receipt
// (PRD 7), and RIV checks signed copies before using them as evidence.
router.post("/commitments/:id/upload", receiveFile, asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const kind = v.oneOf(req.body?.kind, ["Payment confirmation", "Signed document"], "Upload type", { required: true });
  const c = await ownCommitment(req.user.id, id);
  if (c.status !== "Active") throw httpError(400, "This commitment isn't active.");
  const document = await inTransaction(pool, async (client) => {
    const doc = await saveDocument(client, {
      file: req.file, docType: kind, title: kind === "Payment confirmation" ? "Payment confirmation from investor" : `Signed copy: ${req.file.originalname}`,
      linkedType: "commitment", linkedId: id, confidentiality: "Shareable with investor", source: "Investor upload", uploadedBy: req.user.id,
    });
    await logAudit({ actorId: req.user.id, action: "commitment.investor_upload", objectType: "commitment", objectId: id, details: { kind }, req }, client);
    await notifyAdmins(client, { type: "investor_upload", title: `${c.investor_name} uploaded a ${kind.toLowerCase()}`, body: c.vehicle_name, linkView: "commitments", linkId: id });
    return { id: doc.id, filename: doc.filename, doc_type: doc.doc_type, uploaded_at: doc.uploaded_at };
  });
  res.status(201).json({ document });
}));

// ---------- M6: updates, statement, profile (PRD 6.14) ----------
router.get("/updates", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  const { rows } = await pool.query(
    `SELECT u.id, u.type, u.title, u.body, u.published_at, veh.name AS vehicle_name, d.first_read_at,
            coalesce((SELECT json_agg(json_build_object('id', doc.id, 'filename', doc.filename) ORDER BY doc.uploaded_at)
                      FROM documents doc WHERE doc.linked_type = 'update' AND doc.linked_id = u.id AND doc.voided_at IS NULL), '[]') AS attachments
     FROM update_deliveries d
     JOIN investor_updates u ON u.id = d.update_id
     JOIN vehicles veh ON veh.id = u.vehicle_id
     WHERE d.investor_id = $1 AND u.status = 'Published'
     ORDER BY u.published_at DESC`,
    [inv.id]
  );
  res.json({ updates: rows });
}));

router.post("/updates/:id/read", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  await pool.query(
    "UPDATE update_deliveries SET first_read_at = now(), first_read_by = $3 WHERE update_id = $1 AND investor_id = $2 AND first_read_at IS NULL",
    [v.id(req.params.id, "update"), inv.id, req.user.id]
  );
  res.json({ ok: true });
}));

router.get("/statement", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  const asOf = v.date(req.query.as_of, "As-of date") || new Date().toISOString().slice(0, 10);
  res.json({ statement: await statementFor(pool, inv.id, asOf) });
}));

async function readProfile(userId) {
  const inv = await investorForUser(userId);
  const { rows } = await pool.query("SELECT name, email, phone FROM investor_contacts WHERE id = $1", [inv.contact_id]);
  return { legal_name: inv.legal_name, country: inv.country, kind: inv.kind, contact: rows[0] };
}

router.get("/profile", asyncRoute(async (req, res) => {
  res.json({ profile: await readProfile(req.user.id) });
}));

// Contact details change straight away. Legal details reopen compliance
// review (PRD 6.14): a Submitted or Cleared KYC file goes back to the investor
// and RIV is alerted.
router.patch("/profile", asyncRoute(async (req, res) => {
  const inv = await investorForUser(req.user.id);
  const b = req.body || {};
  const name = v.text(b.name, "Your name", { required: true, max: 200 });
  const phone = v.text(b.phone, "Phone", { max: 50 });
  const legalName = v.text(b.legal_name, "Legal name", { required: true, max: 300 });
  const country = v.text(b.country, "Country", { max: 100 });
  const legalChanged = legalName !== inv.legal_name || (country || null) !== (inv.country || null);
  let kycReopened = false;
  await inTransaction(pool, async (client) => {
    await client.query("UPDATE investor_contacts SET name = $2, phone = $3 WHERE id = $1", [inv.contact_id, name, phone]);
    await client.query("UPDATE users SET name = $2 WHERE id = $1", [req.user.id, name]);
    await logAudit({ actorId: req.user.id, action: "investor.contact_updated", objectType: "investor", objectId: inv.id, details: { contact: name }, req }, client);
    if (!legalChanged) return;
    await client.query("UPDATE investors SET legal_name = $2, country = $3, updated_at = now() WHERE id = $1", [inv.id, legalName, country]);
    const { rows: reopened } = await client.query(
      `UPDATE kyc_files SET status = 'Information requested', decision_note = $2, updated_at = now()
       WHERE investor_id = $1 AND is_current AND status IN ('Submitted', 'Cleared') RETURNING id`,
      [inv.id, "You changed your legal details. RIV needs to review them again. Please check your documents match and resubmit."]
    );
    kycReopened = Boolean(reopened[0]);
    await logAudit({
      actorId: req.user.id, action: "investor.legal_details_changed", objectType: "investor", objectId: inv.id,
      details: { from: { legal_name: inv.legal_name, country: inv.country }, to: { legal_name: legalName, country }, kyc_reopened: kycReopened }, req,
    }, client);
    await notifyAdmins(client, {
      type: "kyc_admin", title: `Legal details changed: ${legalName}`, body: kycReopened ? `Was ${inv.legal_name}. KYC reopened for review.` : `Was ${inv.legal_name}.`,
      linkView: "kyc", linkId: reopened[0]?.id ?? null,
    });
  });
  res.json({ profile: await readProfile(req.user.id), kyc_reopened: kycReopened });
}));

module.exports = router;
