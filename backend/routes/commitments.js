// Commitments: the admin side of every flow (PRD 6.5-6.8, 6.13, 7, 8.6).
// Mounted at /api/admin/commitments; admin only.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const { logAudit } = require("../lib/audit.js");
const { receiveFile, saveDocument } = require("../lib/documents.js");
const E = require("../lib/commitments.js");

const router = Router();
router.use(requireAuth, requireAdmin);

const LIST_SQL = `
  SELECT c.id, c.investor_id, c.vehicle_id, c.flow, c.stage, c.status, c.source, c.created_via,
         c.indicative_amount, c.committed_amount, c.expected_close_date, c.created_at, c.updated_at,
         coalesce(i.display_name, i.legal_name) AS investor_name, i.kind AS investor_kind,
         v.name AS vehicle_name, v.type AS vehicle_type, p.full_name AS partner_name,
         coalesce((SELECT sum(m.amount) FROM money_movements m
                   WHERE m.commitment_id = c.id AND m.type = 'Subscription payment' AND m.voided_at IS NULL), 0) AS received_total,
         (c.eligibility->>'pass')::boolean AS eligible
  FROM commitments c
  JOIN investors i ON i.id = c.investor_id
  JOIN vehicles v ON v.id = c.vehicle_id
  LEFT JOIN venture_partners p ON p.id = c.partner_id`;

router.get("/", asyncRoute(async (req, res) => {
  const where = [];
  const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace("?", `$${params.length}`)); };
  if (req.query.vehicle_id) add("c.vehicle_id = ?", v.id(req.query.vehicle_id, "vehicle"));
  if (req.query.investor_id) add("c.investor_id = ?", v.id(req.query.investor_id, "investor"));
  if (req.query.flow) add("c.flow = ?", v.oneOf(req.query.flow, Object.keys(E.FLOWS), "Flow"));
  if (req.query.status === "live") where.push("c.status IN ('Active', 'On hold')");
  else if (req.query.status) add("c.status = ?", v.oneOf(req.query.status, ["Active", ...E.EXIT_STATUSES], "Status"));
  if (req.query.stage) add("c.stage = ?", v.text(req.query.stage, "Stage", { max: 60 }));
  if (req.query.q) add("lower(coalesce(i.display_name, i.legal_name)) LIKE ?", `%${String(req.query.q).toLowerCase().slice(0, 100)}%`);
  const { rows } = await pool.query(`${LIST_SQL} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.updated_at DESC LIMIT 500`, params);
  res.json({ commitments: rows });
}));

router.post("/", asyncRoute(async (req, res) => {
  const b = req.body || {};
  const investorId = v.id(b.investor_id, "investor");
  const vehicleId = v.id(b.vehicle_id, "vehicle");
  const amount = v.number(b.indicative_amount, "Indicative amount", { required: true, min: 1, max: 1e12 });
  const note = v.text(b.note, "Note", { max: 2000 });
  const expected = v.date(b.expected_close_date, "Expected close date");
  const id = await inTransaction(pool, (client) => E.createCommitment(client, {
    investorId, vehicleId, amount, createdVia: "Admin", actorId: req.user.id, note, expectedCloseDate: expected, req,
  }));
  res.status(201).json({ commitment: await E.loadCommitment(pool, id) });
}));

// Everything the commitment screen shows, including what the next stage
// still needs.
router.get("/:id", asyncRoute(async (req, res) => {
  const c = await E.loadCommitment(pool, v.id(req.params.id, "commitment"));
  const next = E.nextStage(c.flow, c.stage);
  const nextReadiness = next ? await E.readiness(pool, c, next) : null;
  const [events, notes, documents, instructions, receipts] = await Promise.all([
    pool.query(
      `SELECT e.*, u.name AS actor_name FROM commitment_events e LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE e.commitment_id = $1 ORDER BY e.created_at, e.id`, [c.id]),
    pool.query(
      `SELECT n.*, u.name AS author_name FROM commitment_notes n LEFT JOIN users u ON u.id = n.author_user_id
       WHERE n.commitment_id = $1 ORDER BY n.created_at DESC`, [c.id]),
    pool.query(
      `SELECT d.id, d.doc_type, d.title, d.filename, d.size_bytes, d.confidentiality, d.signature_status, d.source, d.version,
              d.evidence_stage, d.uploaded_at, d.voided_at, d.void_reason, u.name AS uploaded_by_name
       FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.linked_type = 'commitment' AND d.linked_id = $1 ORDER BY d.uploaded_at DESC`, [c.id]),
    pool.query(
      `SELECT p.*, u.name AS issued_by_name FROM payment_instructions p LEFT JOIN users u ON u.id = p.issued_by
       WHERE p.commitment_id = $1 ORDER BY p.issued_at DESC`, [c.id]),
    pool.query(
      `SELECT m.*, u.name AS recorded_by_name, d.filename AS proof_filename FROM money_movements m
       LEFT JOIN users u ON u.id = m.recorded_by LEFT JOIN documents d ON d.id = m.proof_document_id
       WHERE m.commitment_id = $1 AND m.type = 'Subscription payment' ORDER BY m.value_date, m.id`, [c.id]),
  ]);
  res.json({
    commitment: c,
    stages: E.FLOWS[c.flow],
    eligibility: E.checkEligibility(c),
    next_stage: next,
    next: nextReadiness,
    events: events.rows,
    notes: notes.rows,
    documents: documents.rows,
    instructions: instructions.rows,
    receipts: receipts.rows,
    outstanding: c.committed_amount ? Math.max(0, Number(c.committed_amount) - Number(c.received_total)) : null,
  });
}));

router.patch("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const b = req.body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const commitment = await inTransaction(pool, async (client) => {
    const c = await E.loadCommitment(client, id, { lock: true });
    const f = {};
    if (has("indicative_amount")) {
      // The indicative amount is fixed once documents are executed or a
      // soft commitment is confirmed.
      if (c.committed_amount || c.soft_confirmed_at) throw httpError(400, "The amount is already fixed for this commitment.");
      f.indicative_amount = v.number(b.indicative_amount, "Indicative amount", { required: true, min: 1, max: 1e12 });
    }
    if (has("expected_close_date")) f.expected_close_date = v.date(b.expected_close_date, "Expected close date");
    if (has("investor_note")) f.investor_note = v.text(b.investor_note, "Note", { max: 2000 });
    const cols = Object.keys(f);
    if (!cols.length) throw httpError(400, "Nothing to change.");
    const { rows } = await client.query(
      `UPDATE commitments SET ${cols.map((col, i) => `${col} = $${i + 2}`).join(", ")}, updated_at = now(), updated_by = $${cols.length + 2}
       WHERE id = $1 RETURNING *`,
      [id, ...cols.map((col) => f[col]), req.user.id]
    );
    await logAudit({ actorId: req.user.id, action: "commitment.updated", objectType: "commitment", objectId: id, details: Object.fromEntries(cols.map((col) => [col, f[col]])), req }, client);
    if (f.indicative_amount !== undefined && c.stage === "Intent") await E.recheck(client, id, { actorId: req.user.id, req });
    return rows[0];
  });
  res.json({ commitment });
}));

router.post("/:id/check-eligibility", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const result = await inTransaction(pool, (client) => E.recheck(client, id, { actorId: req.user.id, req }));
  res.json({ eligibility: result, commitment: await E.loadCommitment(pool, id) });
}));

// Admin can let a commitment below the minimum ticket through, with a
// logged reason (PRD 6.5, 7). Only the minimum can be overridden.
router.post("/:id/override-minimum", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const reason = v.text(req.body?.reason, "Reason", { required: true, max: 1000 });
  const result = await inTransaction(pool, async (client) => {
    const c = await E.loadCommitment(client, id, { lock: true });
    if (c.status !== "Active") throw httpError(400, "Reopen the commitment first.");
    await client.query("UPDATE commitments SET min_override_reason = $2, min_override_by = $3, updated_at = now() WHERE id = $1", [id, reason, req.user.id]);
    await logAudit({ actorId: req.user.id, action: "commitment.minimum_overridden", objectType: "commitment", objectId: id, details: { reason }, req }, client);
    return E.recheck(client, id, { actorId: req.user.id, req });
  });
  res.json({ eligibility: result, commitment: await E.loadCommitment(pool, id) });
}));

router.post("/:id/advance", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const b = req.body || {};
  const toStage = v.text(b.to_stage, "Stage", { required: true, max: 60 });
  const body = {};
  if (b.committed_amount !== undefined && b.committed_amount !== "") body.committed_amount = v.number(b.committed_amount, "Committed amount", { min: 1, max: 1e12 });
  if (b.shares_issued !== undefined && b.shares_issued !== "") body.shares_issued = v.number(b.shares_issued, "Shares issued", { min: 0.0001, max: 1e15 });
  if (b.share_certificate_no !== undefined) body.share_certificate_no = v.text(b.share_certificate_no, "Share certificate number", { max: 100 });
  if (b.funds_transferred_amount !== undefined && b.funds_transferred_amount !== "") body.funds_transferred_amount = v.number(b.funds_transferred_amount, "Amount received by the startup", { min: 1, max: 1e12 });
  if (b.funds_transferred_date !== undefined && b.funds_transferred_date !== "") body.funds_transferred_date = v.date(b.funds_transferred_date, "Date received by the startup");
  const note = v.text(b.note, "Note", { max: 1000 });
  await inTransaction(pool, async (client) => {
    const c = await E.loadCommitment(client, id, { lock: true });
    // Committing below the minimum still needs the override (PRD 7).
    if (body.committed_amount) {
      const min = c.investor_kind === "Individual" ? c.min_ticket_individual : c.min_ticket_entity;
      if (min && body.committed_amount < Number(min) && !c.min_override_reason) throw httpError(400, `USD ${body.committed_amount.toLocaleString("en-US")} is below the minimum ticket. Override the minimum first.`);
    }
    await E.advance(client, c, { toStage, body, actorId: req.user.id, req, note });
  });
  res.json({ commitment: await E.loadCommitment(pool, id) });
}));

// Exit states (PRD 6.13): On hold, Dropped, Rejected, Withdrawn, always
// with a reason. Reopening is admin-only and logged.
router.post("/:id/exit", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const status = v.oneOf(req.body?.status, E.EXIT_STATUSES, "Status", { required: true });
  const reason = v.text(req.body?.reason, "Reason", { required: true, max: 1000 });
  await inTransaction(pool, async (client) => {
    const c = await E.loadCommitment(client, id, { lock: true });
    if (c.status === status) throw httpError(400, `Already ${status.toLowerCase()}.`);
    // Active -> any exit state; On hold -> a final exit; a final exit needs
    // reopening first.
    if (!["Active", "On hold"].includes(c.status)) throw httpError(400, "Reopen it first.");
    await client.query("UPDATE commitments SET status = $2, exit_reason = $3, updated_at = now(), updated_by = $4 WHERE id = $1", [id, status, reason, req.user.id]);
    await E.recordEvent(client, c, { toStatus: status, note: reason, actorId: req.user.id });
    await logAudit({ actorId: req.user.id, action: "commitment.status_changed", objectType: "commitment", objectId: id, details: { from: c.status, to: status, reason }, req }, client);
  });
  res.json({ commitment: await E.loadCommitment(pool, id) });
}));

router.post("/:id/reopen", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const note = v.text(req.body?.note, "Note", { required: true, max: 1000 });
  await inTransaction(pool, async (client) => {
    const c = await E.loadCommitment(client, id, { lock: true });
    if (c.status === "Active") throw httpError(400, "It's already active.");
    try {
      await client.query("UPDATE commitments SET status = 'Active', exit_reason = NULL, updated_at = now(), updated_by = $2 WHERE id = $1", [id, req.user.id]);
    } catch (err) {
      if (err.code === "23505") throw httpError(409, "This investor already has another live commitment for this vehicle.");
      throw err;
    }
    await E.recordEvent(client, c, { toStatus: "Active", note: `Reopened: ${note}`, actorId: req.user.id });
    await logAudit({ actorId: req.user.id, action: "commitment.reopened", objectType: "commitment", objectId: id, details: { from: c.status, note }, req }, client);
  });
  res.json({ commitment: await E.loadCommitment(pool, id) });
}));

router.post("/:id/notes", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const note = v.text(req.body?.note, "Note", { required: true, max: 4000 });
  await E.loadCommitment(pool, id);
  const { rows } = await pool.query("INSERT INTO commitment_notes (commitment_id, note, author_user_id) VALUES ($1, $2, $3) RETURNING *", [id, note, req.user.id]);
  res.status(201).json({ note: rows[0] });
}));

// ---------- IB data-room access (PRD 6.8.2 stage 3) ----------
router.post("/:id/data-room/:action", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const action = v.oneOf(req.params.action, ["grant", "revoke"], "Action", { required: true });
  await inTransaction(pool, async (client) => {
    const c = await E.loadCommitment(client, id, { lock: true });
    if (c.flow !== "IB") throw httpError(400, "Data rooms are for IB deals.");
    const { rows } = await client.query("SELECT data_room_url, deal_status FROM ib_deals WHERE vehicle_id = $1", [c.vehicle_id]);
    if (action === "grant") {
      if (c.status !== "Active") throw httpError(400, "Reopen the commitment first.");
      if (!rows[0]?.data_room_url) throw httpError(400, "Add the data room link to the deal first.");
      if (E.stageIndex("IB", c.stage) < E.stageIndex("IB", "NDA signed")) throw httpError(400, "The investor must sign the NDA before getting data-room access.");
      if (c.data_room_granted_at) throw httpError(400, "Access is already granted.");
      await client.query("UPDATE commitments SET data_room_granted_at = now(), updated_at = now() WHERE id = $1", [id]);
    } else {
      if (!c.data_room_granted_at) throw httpError(400, "Access isn't granted.");
      await client.query("UPDATE commitments SET data_room_granted_at = NULL, updated_at = now() WHERE id = $1", [id]);
    }
    await client.query("INSERT INTO deal_access_log (vehicle_id, commitment_id, action, actor_user_id) VALUES ($1, $2, $3, $4)", [c.vehicle_id, id, action === "grant" ? "Granted" : "Revoked", req.user.id]);
    await logAudit({ actorId: req.user.id, action: `deal.data_room_${action === "grant" ? "granted" : "revoked"}`, objectType: "commitment", objectId: id, req }, client);
  });
  res.json({ commitment: await E.loadCommitment(pool, id) });
}));

// ---------- payment instructions (HoldCo, PRD 6.6 stage 4) ----------
router.post("/:id/instructions", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const dueDate = v.date(req.body?.due_date, "Due date", { required: true });
  const instruction = await inTransaction(pool, async (client) => {
    const c = await E.loadCommitment(client, id, { lock: true });
    if (c.flow !== "HoldCo") throw httpError(400, "Payment instructions are for HoldCo subscriptions.");
    if (c.status !== "Active") throw httpError(400, "Reopen the commitment first.");
    if (!["Fully executed", "Funds due"].includes(c.stage)) throw httpError(400, "Issue payment instructions once the documents are fully executed.");
    // Bank details only ever come from the vehicle's approved account (PRD 7).
    if (!c.bank_approved_at) throw httpError(400, "This vehicle has no approved receiving account yet. Set one up on the Vehicles page (two admins).");
    const outstanding = Number(c.committed_amount) - Number(c.received_total);
    if (outstanding <= 0) throw httpError(400, "Nothing is outstanding.");
    const reference = `RICAP-${c.flow === "HoldCo" ? "HC" : "FD"}-${String(c.id).padStart(5, "0")}-${Date.now().toString(36).toUpperCase()}`;
    let rows;
    try {
      ({ rows } = await client.query(
        `INSERT INTO payment_instructions (commitment_id, amount, due_date, reference, legal_entity, bank_name, bank_account_name, bank_iban, bank_swift, issued_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [id, outstanding, dueDate, reference, c.legal_entity, c.bank_name, c.bank_account_name, c.bank_iban, c.bank_swift, req.user.id]
      ));
    } catch (err) {
      if (err.code === "23505") throw httpError(409, "Live payment instructions already exist. Void them first to issue new ones.");
      throw err;
    }
    await logAudit({ actorId: req.user.id, action: "commitment.instructions_issued", objectType: "commitment", objectId: id, details: { amount: outstanding, due_date: dueDate }, req }, client);
    if (c.stage === "Fully executed") await E.advance(client, c, { toStage: "Funds due", actorId: req.user.id, req, note: "Payment instructions issued" });
    return rows[0];
  });
  res.status(201).json({ instruction });
}));

router.post("/:id/instructions/:instructionId/void", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const iid = v.id(req.params.instructionId, "instruction");
  const reason = v.text(req.body?.reason, "Reason", { required: true, max: 1000 });
  await inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      "UPDATE payment_instructions SET voided_at = now(), voided_by = $3, void_reason = $4 WHERE id = $1 AND commitment_id = $2 AND voided_at IS NULL RETURNING id",
      [iid, id, req.user.id, reason]
    );
    if (!rows[0]) throw httpError(404, "Live payment instructions not found.");
    await logAudit({ actorId: req.user.id, action: "commitment.instructions_voided", objectType: "commitment", objectId: id, details: { reason }, req }, client);
  });
  res.json({ ok: true });
}));

// ---------- money received (PRD 6.6 stage 5, 7, 8.8) ----------
// Only admins record receipts, always with bank proof. Partial receipts are
// fine; once the full committed amount is in, the commitment moves to
// Funds received.
router.post("/:id/receipts", receiveFile, asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const b = req.body || {};
  const amount = v.number(b.amount, "Amount", { required: true, min: 0.01, max: 1e12 });
  const valueDate = v.date(b.value_date, "Value date", { required: true });
  const bankRef = v.text(b.bank_reference, "Bank reference", { required: true, max: 200 });
  const counterparty = v.text(b.counterparty, "Paid by", { max: 200 });
  const receipt = await inTransaction(pool, async (client) => {
    const c = await E.loadCommitment(client, id, { lock: true });
    if (c.flow !== "HoldCo") throw httpError(400, "Receipts are recorded for HoldCo subscriptions.");
    if (c.status !== "Active") throw httpError(400, "Reopen the commitment first.");
    if (c.stage !== "Funds due") throw httpError(400, "Record receipts once payment instructions are issued (stage Funds due).");
    const outstanding = Number(c.committed_amount) - Number(c.received_total);
    if (amount > outstanding + 0.005) throw httpError(400, `That's more than the USD ${outstanding.toLocaleString("en-US", { minimumFractionDigits: 2 })} outstanding.`);
    const proof = await saveDocument(client, {
      file: req.file, docType: "Bank proof", title: `Bank proof ${bankRef}`, linkedType: "commitment", linkedId: id,
      confidentiality: "Internal", source: "Admin upload", uploadedBy: req.user.id,
    });
    const { rows } = await client.query(
      `INSERT INTO money_movements (direction, type, commitment_id, vehicle_id, amount, value_date, counterparty, bank_reference, proof_document_id, recorded_by)
       VALUES ('In', 'Subscription payment', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, c.vehicle_id, amount, valueDate, counterparty, bankRef, proof.id, req.user.id]
    );
    await logAudit({ actorId: req.user.id, action: "money.received", objectType: "commitment", objectId: id, details: { amount, value_date: valueDate, reference: bankRef }, req }, client);
    const after = await E.loadCommitment(client, id, { lock: true });
    if (Number(after.received_total) >= Number(after.committed_amount)) {
      await E.advance(client, after, { toStage: "Funds received", actorId: req.user.id, req, note: "Paid in full" });
    }
    return rows[0];
  });
  res.status(201).json({ receipt, commitment: await E.loadCommitment(pool, id) });
}));

router.post("/:id/receipts/:receiptId/void", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  const rid = v.id(req.params.receiptId, "receipt");
  const reason = v.text(req.body?.reason, "Reason", { required: true, max: 1000 });
  await inTransaction(pool, async (client) => {
    const c = await E.loadCommitment(client, id, { lock: true });
    if (E.stageIndex(c.flow, c.stage) > E.stageIndex(c.flow, "Funds received")) throw httpError(400, "Shares are already issued; this receipt can't be voided.");
    const { rows } = await client.query(
      `UPDATE money_movements SET voided_at = now(), voided_by = $3, void_reason = $4
       WHERE id = $1 AND commitment_id = $2 AND voided_at IS NULL RETURNING amount`,
      [rid, id, req.user.id, reason]
    );
    if (!rows[0]) throw httpError(404, "Receipt not found.");
    await logAudit({ actorId: req.user.id, action: "money.receipt_voided", objectType: "commitment", objectId: id, details: { amount: rows[0].amount, reason }, req }, client);
    // A voided receipt can leave the commitment short again.
    if (c.stage === "Funds received") {
      await client.query("UPDATE commitments SET stage = 'Funds due', updated_at = now(), updated_by = $2 WHERE id = $1", [id, req.user.id]);
      await E.recordEvent(client, c, { toStage: "Funds due", note: `Receipt voided: ${reason}`, actorId: req.user.id });
    }
  });
  res.json({ commitment: await E.loadCommitment(pool, id) });
}));

// ---------- Fund soft commitments (PRD 6.7) ----------
// Admin records an investor's emailed confirmation (with the email as
// proof). Investors can also confirm themselves in the portal.
router.post("/:id/soft-confirm", receiveFile, asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "commitment");
  await inTransaction(pool, async (client) => {
    const c = await E.loadCommitment(client, id, { lock: true });
    if (c.flow !== "Fund" || c.stage !== "Soft commitment") throw httpError(400, "Only a Fund soft commitment can be confirmed.");
    await saveDocument(client, {
      file: req.file, docType: "Soft commitment confirmation", title: "Investor's emailed confirmation", linkedType: "commitment", linkedId: id,
      confidentiality: "Internal", source: "Received by email", uploadedBy: req.user.id,
    });
    await client.query("UPDATE commitments SET soft_confirmed_at = now(), soft_confirmation_method = 'Email' WHERE id = $1", [id]);
    await E.advance(client, { ...c, soft_confirmed_at: new Date() }, { toStage: "Soft commitment confirmed", actorId: req.user.id, req, note: "Confirmed by email" });
  });
  res.json({ commitment: await E.loadCommitment(pool, id) });
}));

module.exports = router;
