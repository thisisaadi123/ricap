// IB deals (Capital Advisory, PRD 6.8): deal setup, mandate, going live,
// closing, and fee invoices to the startup. Mounted at /api/admin/deals;
// admin only.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const { logAudit } = require("../lib/audit.js");
const { receiveFile, saveDocument } = require("../lib/documents.js");
const D = require("../lib/deals.js");
const E = require("../lib/commitments.js");

const router = Router();
router.use(requireAuth, requireAdmin);

// Capital placed = what startups have confirmed receiving from investors
// whose commitments are live at Funds transferred or Closed.
const PLACED_SQL = `
  coalesce((SELECT sum(c.funds_transferred_amount) FROM commitments c
            WHERE c.vehicle_id = d.vehicle_id AND c.status IN ('Active', 'On hold')
              AND c.stage IN ('Funds transferred', 'Closed')), 0)`;

const LIST_SQL = `
  SELECT d.*, v.name, v.summary,
         ${PLACED_SQL} AS capital_placed,
         (SELECT count(*)::int FROM commitments c WHERE c.vehicle_id = d.vehicle_id AND c.status IN ('Active', 'On hold')) AS live_count,
         coalesce((SELECT sum(fee_amount) FROM fee_invoices f WHERE f.vehicle_id = d.vehicle_id AND f.status <> 'Void'), 0) AS fees_invoiced,
         coalesce((SELECT sum(fee_amount) FROM fee_invoices f WHERE f.vehicle_id = d.vehicle_id AND f.status = 'Paid'), 0) AS fees_received
  FROM ib_deals d JOIN vehicles v ON v.id = d.vehicle_id`;

function readDeal(b, { partial }) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k) || (!partial && ["startup_name", "instrument", "round_size", "pre_money_valuation"].includes(k));
  if (has("startup_name")) out.startup_name = v.text(b.startup_name, "Startup name", { required: true, max: 200 });
  if (has("rise_startup_id")) out.rise_startup_id = v.text(b.rise_startup_id, "RISE startup ID", { max: 100 });
  if (has("sector")) out.sector = v.text(b.sector, "Sector", { max: 100 });
  if (has("instrument")) out.instrument = v.oneOf(b.instrument, ["Equity", "SAFE", "Convertible", "Other"], "Instrument", { required: true });
  if (has("round_size")) out.round_size = v.number(b.round_size, "Round size", { required: true, min: 1, max: 1e12 });
  if (has("pre_money_valuation")) out.pre_money_valuation = v.number(b.pre_money_valuation, "Pre-money valuation", { required: true, min: 1, max: 1e13 });
  if (has("riv_allocation")) out.riv_allocation = v.number(b.riv_allocation, "RIV allocation", { min: 1, max: 1e12 });
  if (has("fee_pct")) out.fee_pct = v.number(b.fee_pct, "Fee %", { required: true, min: 0, max: 100 });
  if (has("sweat_equity_pct")) out.sweat_equity_pct = v.number(b.sweat_equity_pct, "Sweat equity %", { min: 0, max: 100 }) ?? 0;
  if (has("exclusivity")) out.exclusivity = v.bool(b.exclusivity);
  if (has("term_start")) out.term_start = v.date(b.term_start, "Mandate start");
  if (has("term_end")) out.term_end = v.date(b.term_end, "Mandate end");
  if (has("below_floor_reason")) out.below_floor_reason = v.text(b.below_floor_reason, "Reason for going below the floor", { max: 2000 });
  if (has("data_room_url")) out.data_room_url = v.text(b.data_room_url, "Data room link", { max: 1000 });
  if (out.data_room_url && !/^https:\/\//i.test(out.data_room_url)) throw httpError(400, "The data room link must start with https://");
  if (has("startup_contact_name")) out.startup_contact_name = v.text(b.startup_contact_name, "Startup contact", { max: 200 });
  if (has("startup_contact_email")) out.startup_contact_email = v.email(b.startup_contact_email, "Startup contact email");
  if (out.term_start && out.term_end && out.term_end < out.term_start) throw httpError(400, "The mandate can't end before it starts.");
  return out;
}

function readVehicleFields(b) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(b, "name")) out.name = v.text(b.name, "Deal name", { required: true, max: 200 });
  if (Object.prototype.hasOwnProperty.call(b, "summary")) out.summary = v.text(b.summary, "Teaser summary", { max: 4000 });
  if (Object.prototype.hasOwnProperty.call(b, "visible_to_partners")) out.visible_to_partners = v.bool(b.visible_to_partners);
  if (Object.prototype.hasOwnProperty.call(b, "visible_to_investors")) out.visible_to_investors = v.bool(b.visible_to_investors);
  return out;
}

router.get("/", asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`${LIST_SQL} ORDER BY CASE d.deal_status WHEN 'Live' THEN 0 WHEN 'Mandate signed' THEN 1 WHEN 'Sourced' THEN 2 ELSE 3 END, d.created_at DESC`);
  res.json({ deals: rows.map((d) => ({ ...d, floor_problems: D.floorProblems(d), consideration: D.consideration(d, d.capital_placed) })) });
}));

router.post("/", asyncRoute(async (req, res) => {
  const b = req.body || {};
  const deal = readDeal(b, { partial: false });
  const veh = readVehicleFields(b);
  const problems = D.floorProblems({ ...deal, sweat_equity_pct: deal.sweat_equity_pct ?? 0 });
  if (problems.length) throw httpError(400, problems.join(" "));
  const vehicleId = await inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO vehicles (type, name, legal_entity, status, target_raise, pre_money_valuation, summary, visible_to_partners, visible_to_investors)
       VALUES ('IB Deal', $1, 'Retail X HoldCo', 'Draft', $2, $3, $4, $5, $6) RETURNING id`,
      [veh.name || `${deal.startup_name} ${deal.instrument === "Equity" ? "round" : deal.instrument}`, deal.riv_allocation || deal.round_size, deal.pre_money_valuation,
       veh.summary || null, veh.visible_to_partners ?? true, veh.visible_to_investors ?? true]
    );
    const cols = Object.keys(deal);
    await client.query(
      `INSERT INTO ib_deals (vehicle_id, ${cols.join(", ")}, created_by) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")}, $${cols.length + 2})`,
      [rows[0].id, ...cols.map((c) => deal[c]), req.user.id]
    );
    await logAudit({ actorId: req.user.id, action: "deal.created", objectType: "vehicle", objectId: rows[0].id, details: { startup: deal.startup_name, round: deal.round_size }, req }, client);
    return rows[0].id;
  });
  res.status(201).json({ deal: await D.loadDeal(pool, vehicleId) });
}));

router.get("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "deal");
  const { rows } = await pool.query(`${LIST_SQL} WHERE d.vehicle_id = $1`, [id]);
  const deal = rows[0];
  if (!deal) throw httpError(404, "Deal not found.");
  const nextIdx = D.DEAL_STAGES.indexOf(deal.deal_status) + 1;
  const next = nextIdx > 0 && nextIdx < D.DEAL_STAGES.length ? D.DEAL_STAGES[nextIdx] : null;
  const [commitments, invoices, access] = await Promise.all([
    pool.query(
      `SELECT c.id, c.stage, c.status, c.indicative_amount, c.committed_amount, c.funds_transferred_amount, c.funds_transferred_date,
              c.invoice_id, c.data_room_granted_at, coalesce(i.display_name, i.legal_name) AS investor_name, p.full_name AS partner_name
       FROM commitments c JOIN investors i ON i.id = c.investor_id LEFT JOIN venture_partners p ON p.id = c.partner_id
       WHERE c.vehicle_id = $1 ORDER BY c.created_at`, [id]),
    pool.query(
      `SELECT f.*, u.name AS created_by_name FROM fee_invoices f LEFT JOIN users u ON u.id = f.created_by
       WHERE f.vehicle_id = $1 ORDER BY f.created_at DESC`, [id]),
    pool.query(
      `SELECT a.*, u.name AS actor_name, coalesce(i.display_name, i.legal_name) AS investor_name
       FROM deal_access_log a JOIN commitments c ON c.id = a.commitment_id JOIN investors i ON i.id = c.investor_id
       LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.vehicle_id = $1 ORDER BY a.created_at DESC`, [id]),
  ]);
  res.json({
    deal,
    floor_problems: D.floorProblems(deal),
    consideration: D.consideration(deal, deal.capital_placed),
    next_stage: next,
    next_evidence: next ? await D.dealEvidence(pool, deal, next) : [],
    commitments: commitments.rows,
    invoices: invoices.rows.map((f) => ({ ...f, overdue: f.status === "Sent" && new Date(f.due_date) < new Date(new Date().toDateString()) })),
    access_log: access.rows,
  });
}));

router.patch("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "deal");
  const b = req.body || {};
  const changes = readDeal(b, { partial: true });
  const veh = readVehicleFields(b);
  await inTransaction(pool, async (client) => {
    const current = await D.loadDeal(client, id, { lock: true });
    if (["Closed", "Withdrawn"].includes(current.deal_status)) throw httpError(400, `This deal is ${current.deal_status.toLowerCase()}.`);
    const merged = { ...current, ...changes };
    if (merged.term_start && merged.term_end && D.isoDate(merged.term_end) < D.isoDate(merged.term_start)) throw httpError(400, "The mandate can't end before it starts.");
    const problems = D.floorProblems(merged);
    if (problems.length) throw httpError(400, problems.join(" "));
    const cols = Object.keys(changes);
    if (cols.length) {
      await client.query(`UPDATE ib_deals SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE vehicle_id = $1`, [id, ...cols.map((c) => changes[c])]);
    }
    const vcols = Object.keys(veh);
    const vehicleSync = { target_raise: merged.riv_allocation || merged.round_size, pre_money_valuation: merged.pre_money_valuation };
    const allV = { ...veh, ...vehicleSync };
    await client.query(`UPDATE vehicles SET ${Object.keys(allV).map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [id, ...Object.values(allV)]);
    if (!cols.length && !vcols.length) throw httpError(400, "Nothing to change.");
    await logAudit({ actorId: req.user.id, action: "deal.updated", objectType: "vehicle", objectId: id, details: { fields: [...cols, ...vcols].join(", ") }, req }, client);
  });
  res.json({ deal: await D.loadDeal(pool, id) });
}));

// Sourced -> Mandate signed -> Live (PRD 6.8.1), each with its evidence.
router.post("/:id/advance", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "deal");
  const toStatus = v.oneOf(req.body?.to_status, ["Mandate signed", "Live"], "Stage", { required: true });
  const mandateDate = v.date(req.body?.mandate_signed_date, "Mandate signed on");
  await inTransaction(pool, async (client) => {
    const deal = await D.loadDeal(client, id, { lock: true });
    const expected = D.DEAL_STAGES[D.DEAL_STAGES.indexOf(deal.deal_status) + 1];
    if (toStatus !== expected) throw httpError(400, expected ? `The next stage is "${expected}".` : `This deal is ${deal.deal_status.toLowerCase()}.`);
    const needs = (await D.dealEvidence(client, deal, toStatus)).filter((e) => !e.met).map((e) => `Upload "${e.label}".`);
    if (toStatus === "Mandate signed" && !mandateDate && !deal.mandate_signed_date) needs.push("Enter the date the engagement letter was signed.");
    if (toStatus === "Live" && !deal.summary) needs.push("Write the teaser summary partners and investors will see.");
    needs.push(...D.floorProblems(deal));
    if (needs.length) throw httpError(400, `Not ready for "${toStatus}": ${needs.join(" ")}`);
    await client.query(
      `UPDATE ib_deals SET deal_status = $2, mandate_signed_date = coalesce($3, mandate_signed_date),
         live_at = CASE WHEN $2 = 'Live' THEN now() ELSE live_at END, updated_at = now() WHERE vehicle_id = $1`,
      [id, toStatus, mandateDate]
    );
    await client.query("UPDATE vehicles SET status = $2, updated_at = now() WHERE id = $1", [id, D.VEHICLE_STATUS_FOR_DEAL[toStatus]]);
    await logAudit({ actorId: req.user.id, action: "deal.stage_changed", objectType: "vehicle", objectId: id, details: { from: deal.deal_status, to: toStatus }, req }, client);
  });
  res.json({ deal: await D.loadDeal(pool, id) });
}));

// Close or withdraw (PRD 6.8.1 stage 4): open commitments that didn't
// complete are withdrawn with the reason. Investors whose money the startup
// already confirmed (Funds transferred) stay active until allotment; their
// placement happened.
router.post("/:id/close", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "deal");
  const status = v.oneOf(req.body?.status, ["Closed", "Withdrawn"], "Outcome", { required: true });
  const reason = v.text(req.body?.reason, "Reason", { required: true, max: 1000 });
  const affected = await inTransaction(pool, async (client) => {
    const deal = await D.loadDeal(client, id, { lock: true });
    if (["Closed", "Withdrawn"].includes(deal.deal_status)) throw httpError(400, `Already ${deal.deal_status.toLowerCase()}.`);
    const { rows: open } = await client.query(
      "SELECT id FROM commitments WHERE vehicle_id = $1 AND status IN ('Active', 'On hold') AND stage NOT IN ('Funds transferred', 'Closed')", [id]
    );
    for (const o of open) {
      const c = await E.loadCommitment(client, o.id, { lock: true });
      const why = `Deal ${status.toLowerCase()}: ${reason}`;
      await client.query("UPDATE commitments SET status = 'Withdrawn', exit_reason = $2, updated_at = now(), updated_by = $3 WHERE id = $1", [o.id, why, req.user.id]);
      await E.recordEvent(client, c, { toStatus: "Withdrawn", note: why, actorId: req.user.id });
    }
    await client.query("UPDATE ib_deals SET deal_status = $2, closed_at = now(), close_reason = $3, updated_at = now() WHERE vehicle_id = $1", [id, status, reason]);
    await client.query("UPDATE vehicles SET status = 'Closed', updated_at = now() WHERE id = $1", [id]);
    await logAudit({ actorId: req.user.id, action: status === "Closed" ? "deal.closed" : "deal.withdrawn", objectType: "vehicle", objectId: id, details: { reason, commitments_withdrawn: open.length }, req }, client);
    return open.length;
  });
  res.json({ deal: await D.loadDeal(pool, id), commitments_withdrawn: affected });
}));

// ---------- fee invoices (PRD 6.8.3, 8.11) ----------
// Bills the startup the cash fee on capital placed, plus VAT, for
// investors whose funds the startup has confirmed and who haven't been
// billed yet.
router.post("/:id/invoices", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "deal");
  const dueDate = v.date(req.body?.due_date, "Due date", { required: true });
  const vatPct = v.number(req.body?.vat_pct ?? 5, "VAT %", { required: true, min: 0, max: 100 });
  const invoice = await inTransaction(pool, async (client) => {
    const deal = await D.loadDeal(client, id, { lock: true });
    if (dueDate < new Date().toISOString().slice(0, 10)) throw httpError(400, "The due date can't be in the past.");
    const { rows: billable } = await client.query(
      `SELECT id, funds_transferred_amount FROM commitments
       WHERE vehicle_id = $1 AND status IN ('Active', 'On hold') AND stage IN ('Funds transferred', 'Closed') AND invoice_id IS NULL
       FOR UPDATE`,
      [id]
    );
    if (!billable.length) throw httpError(400, "Nothing to bill: no confirmed placements that haven't been invoiced.");
    const capital = D.round2(billable.reduce((s, c) => s + Number(c.funds_transferred_amount), 0));
    const amounts = D.invoiceAmounts(capital, deal.fee_pct, vatPct);
    if (amounts.fee_amount <= 0) throw httpError(400, "This deal's cash fee is 0%, so there's nothing to invoice in cash.");
    const { rows: seq } = await client.query("SELECT nextval('fee_invoice_seq') AS n");
    const number = `RXH-INV-${new Date().getFullYear()}-${String(seq[0].n).padStart(4, "0")}`;
    const { rows } = await client.query(
      `INSERT INTO fee_invoices (invoice_number, vehicle_id, capital_placed, fee_pct, fee_amount, vat_pct, vat_amount, total, billed_to, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [number, id, capital, deal.fee_pct, amounts.fee_amount, vatPct, amounts.vat_amount, amounts.total, deal.startup_name, dueDate, req.user.id]
    );
    await client.query("UPDATE commitments SET invoice_id = $2 WHERE id = ANY($1)", [billable.map((c) => c.id), rows[0].id]);
    await logAudit({ actorId: req.user.id, action: "invoice.created", objectType: "vehicle", objectId: id, details: { invoice: number, capital, total: amounts.total }, req }, client);
    return rows[0];
  });
  res.status(201).json({ invoice });
}));

async function loadInvoice(db, invoiceId) {
  const { rows } = await db.query("SELECT * FROM fee_invoices WHERE id = $1 FOR UPDATE", [invoiceId]);
  if (!rows[0]) throw httpError(404, "Invoice not found.");
  return rows[0];
}

router.post("/invoices/:invoiceId/send", asyncRoute(async (req, res) => {
  const iid = v.id(req.params.invoiceId, "invoice");
  const invoice = await inTransaction(pool, async (client) => {
    const f = await loadInvoice(client, iid);
    if (f.status !== "Draft") throw httpError(400, `This invoice is ${f.status.toLowerCase()}.`);
    const { rows } = await client.query("UPDATE fee_invoices SET status = 'Sent', sent_at = now() WHERE id = $1 RETURNING *", [iid]);
    await logAudit({ actorId: req.user.id, action: "invoice.sent", objectType: "vehicle", objectId: f.vehicle_id, details: { invoice: f.invoice_number }, req }, client);
    return rows[0];
  });
  res.json({ invoice });
}));

// The startup's payment of the fee lands in Retail X HoldCo's account
// (MON-2). Recorded with bank proof; must match the invoice total.
router.post("/invoices/:invoiceId/payment", receiveFile, asyncRoute(async (req, res) => {
  const iid = v.id(req.params.invoiceId, "invoice");
  const amount = v.number(req.body?.amount, "Amount", { required: true, min: 0.01, max: 1e12 });
  const valueDate = v.date(req.body?.value_date, "Value date", { required: true });
  const bankRef = v.text(req.body?.bank_reference, "Bank reference", { required: true, max: 200 });
  const invoice = await inTransaction(pool, async (client) => {
    const f = await loadInvoice(client, iid);
    if (f.status !== "Sent") throw httpError(400, f.status === "Draft" ? "Mark the invoice as sent first." : `This invoice is ${f.status.toLowerCase()}.`);
    if (Math.abs(amount - Number(f.total)) > 0.005) throw httpError(400, `The payment must match the invoice total of USD ${Number(f.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}.`);
    const proof = await saveDocument(client, {
      file: req.file, docType: "Bank proof", title: `Fee payment ${f.invoice_number}`, linkedType: "vehicle", linkedId: f.vehicle_id,
      confidentiality: "Internal", source: "Admin upload", uploadedBy: req.user.id,
    });
    await client.query(
      `INSERT INTO money_movements (direction, type, vehicle_id, invoice_id, amount, value_date, counterparty, bank_reference, proof_document_id, recorded_by)
       VALUES ('In', 'Fee receipt', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [f.vehicle_id, iid, amount, valueDate, f.billed_to, bankRef, proof.id, req.user.id]
    );
    const { rows } = await client.query("UPDATE fee_invoices SET status = 'Paid', paid_at = now() WHERE id = $1 RETURNING *", [iid]);
    await logAudit({ actorId: req.user.id, action: "invoice.paid", objectType: "vehicle", objectId: f.vehicle_id, details: { invoice: f.invoice_number, amount }, req }, client);
    return rows[0];
  });
  res.json({ invoice });
}));

router.post("/invoices/:invoiceId/void", asyncRoute(async (req, res) => {
  const iid = v.id(req.params.invoiceId, "invoice");
  const reason = v.text(req.body?.reason, "Reason", { required: true, max: 1000 });
  const invoice = await inTransaction(pool, async (client) => {
    const f = await loadInvoice(client, iid);
    if (!["Draft", "Sent"].includes(f.status)) throw httpError(400, `A ${f.status.toLowerCase()} invoice can't be voided.`);
    const { rows } = await client.query("UPDATE fee_invoices SET status = 'Void', void_reason = $2 WHERE id = $1 RETURNING *", [iid, reason]);
    // Its placements can be billed again on a new invoice.
    await client.query("UPDATE commitments SET invoice_id = NULL WHERE invoice_id = $1", [iid]);
    await logAudit({ actorId: req.user.id, action: "invoice.voided", objectType: "vehicle", objectId: f.vehicle_id, details: { invoice: f.invoice_number, reason }, req }, client);
    return rows[0];
  });
  res.json({ invoice });
}));

module.exports = router;
