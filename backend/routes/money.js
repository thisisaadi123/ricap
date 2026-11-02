// Money view, partner payouts, RIV's outbound investments and settings
// (PRD 6.9, 8.8, 8.9, 8.12, 9.2). Mounted at /api/admin/money; admin only.
// Every movement needs bank proof and is voided, never deleted (PRD 7).
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const { logAudit } = require("../lib/audit.js");
const { notifyPartner } = require("../lib/notify.js");
const { receiveFile, saveDocument } = require("../lib/documents.js");
const P = require("../lib/payouts.js");

const router = Router();
router.use(requireAuth, requireAdmin);

const MOVEMENT_TYPES = ["Subscription payment", "Fee receipt", "Partner payout", "Outbound investment", "Refund"];

async function holdCoVehicleId(db) {
  const { rows } = await db.query("SELECT id FROM vehicles WHERE type = 'HoldCo' ORDER BY id LIMIT 1");
  return rows[0]?.id ?? null;
}

// ---------- movements ----------
router.get("/movements", asyncRoute(async (req, res) => {
  const where = [];
  const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace("?", `$${params.length}`)); };
  if (req.query.direction) add("m.direction = ?", v.oneOf(req.query.direction, ["In", "Out"], "Direction"));
  if (req.query.type) add("m.type = ?", v.oneOf(req.query.type, MOVEMENT_TYPES, "Type"));
  if (req.query.from) add("m.value_date >= ?", v.date(req.query.from, "From"));
  if (req.query.to) add("m.value_date <= ?", v.date(req.query.to, "To"));
  if (req.query.reconciled === "no") where.push("m.reconciled_at IS NULL AND m.voided_at IS NULL");
  const { rows } = await pool.query(
    `SELECT m.*, d.filename AS proof_filename, u.name AS recorded_by_name, r.name AS reconciled_by_name,
            veh.name AS vehicle_name, coalesce(i.display_name, i.legal_name) AS investor_name, p.full_name AS partner_name, o.startup_name AS outbound_startup
     FROM money_movements m
     LEFT JOIN documents d ON d.id = m.proof_document_id
     LEFT JOIN users u ON u.id = m.recorded_by
     LEFT JOIN users r ON r.id = m.reconciled_by
     LEFT JOIN vehicles veh ON veh.id = m.vehicle_id
     LEFT JOIN commitments c ON c.id = m.commitment_id
     LEFT JOIN investors i ON i.id = c.investor_id
     LEFT JOIN partner_payouts po ON po.id = m.payout_id
     LEFT JOIN venture_partners p ON p.id = po.partner_id
     LEFT JOIN outbound_investments o ON o.id = m.outbound_investment_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY m.value_date DESC, m.id DESC LIMIT 500`,
    params
  );
  const live = rows.filter((m) => !m.voided_at);
  const sum = (dir) => live.filter((m) => m.direction === dir).reduce((s, m) => s + Number(m.amount), 0);
  res.json({ movements: rows, totals: { in: sum("In"), out: sum("Out"), unreconciled: live.filter((m) => !m.reconciled_at).length } });
}));

router.post("/movements/:id/reconcile", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "movement");
  const { rows } = await pool.query(
    "UPDATE money_movements SET reconciled_by = $2, reconciled_at = now() WHERE id = $1 AND voided_at IS NULL AND reconciled_at IS NULL RETURNING id, amount",
    [id, req.user.id]
  );
  if (!rows[0]) throw httpError(400, "That movement is voided, already reconciled, or doesn't exist.");
  await logAudit({ actorId: req.user.id, action: "money.reconciled", objectType: "money_movement", objectId: id, req });
  res.json({ ok: true });
}));

// Voids a fee receipt, partner payment or outbound payment and puts its
// record back one step. Subscription receipts are voided on the commitment.
router.post("/movements/:id/void", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "movement");
  const reason = v.text(req.body?.reason, "Reason", { required: true, max: 1000 });
  await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM money_movements WHERE id = $1 FOR UPDATE", [id]);
    const m = rows[0];
    if (!m) throw httpError(404, "Movement not found.");
    if (m.voided_at) throw httpError(400, "Already voided.");
    if (m.type === "Subscription payment") throw httpError(400, "Void subscription receipts on the commitment, so its stage stays right.");
    if (m.type === "Fee receipt") {
      const { rows: cs } = await client.query("SELECT id FROM commitments WHERE invoice_id = $1", [m.invoice_id]);
      await P.assertNoPaidPayout(client, cs.map((c) => c.id));
      await client.query("UPDATE fee_invoices SET status = 'Sent', paid_at = NULL WHERE id = $1", [m.invoice_id]);
      await client.query("UPDATE money_movements SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1", [id, req.user.id, reason]);
      for (const c of cs) await P.refreshPayout(client, c.id, { actorId: req.user.id, req });
    } else {
      await client.query("UPDATE money_movements SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1", [id, req.user.id, reason]);
      if (m.type === "Partner payout") await client.query("UPDATE partner_payouts SET status = 'Approved', paid_at = NULL, payment_reference = NULL, updated_at = now() WHERE id = $1", [m.payout_id]);
      if (m.type === "Outbound investment") await client.query("UPDATE outbound_investments SET status = 'Approved', updated_at = now() WHERE id = $1", [m.outbound_investment_id]);
    }
    await logAudit({ actorId: req.user.id, action: "money.voided", objectType: "money_movement", objectId: id, details: { type: m.type, amount: m.amount, reason }, req }, client);
  });
  res.json({ ok: true });
}));

// ---------- partner payouts ----------
const PAYOUT_SQL = `
  SELECT po.*, p.full_name AS partner_name, p.company AS partner_company, veh.name AS vehicle_name,
         coalesce(i.display_name, i.legal_name) AS investor_name, c.stage, c.status AS commitment_status,
         fa.name AS first_approved_by_name, ap.name AS approved_by_name
  FROM partner_payouts po
  JOIN venture_partners p ON p.id = po.partner_id
  JOIN vehicles veh ON veh.id = po.vehicle_id
  JOIN commitments c ON c.id = po.commitment_id
  JOIN investors i ON i.id = c.investor_id
  LEFT JOIN users fa ON fa.id = po.first_approved_by
  LEFT JOIN users ap ON ap.id = po.approved_by`;

router.get("/payouts", asyncRoute(async (req, res) => {
  const params = [];
  let filter = "";
  if (req.query.status) {
    params.push(v.oneOf(req.query.status, ["Accruing", "Earned", "Approved", "Paid", "Cancelled"], "Status"));
    filter = "WHERE po.status = $1";
  }
  const { rows } = await pool.query(`${PAYOUT_SQL} ${filter} ORDER BY po.updated_at DESC LIMIT 500`, params);
  const threshold = await P.secondAdminThreshold(pool);
  // Whether a payout is above the cash received depends on the deal's other
  // payouts too, so work it out now rather than trusting the stored flag.
  const payouts = await Promise.all(rows.map(async (r) => ({
    ...r,
    over_cash_flag: r.status === "Earned" && r.flow === "IB" ? await P.exceedsCashReceived(pool, r.vehicle_id, r.id, r.amount) : r.over_cash_flag,
    needs_second_admin: Number(r.total) > threshold,
  })));
  res.json({ payouts, threshold });
}));

// Approve (PRD 6.9): every payout is admin-approved. Above the threshold a
// second, different admin must also approve (PRD 9.2). An IB payout above
// the cash RIV has received needs an explicit reason (VP-1).
router.post("/payouts/:id/approve", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "payout");
  const reason = v.text(req.body?.over_cash_reason, "Reason", { max: 1000 });
  const payout = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM partner_payouts WHERE id = $1 FOR UPDATE", [id]);
    const po = rows[0];
    if (!po) throw httpError(404, "Payout not found.");
    if (po.status !== "Earned") throw httpError(400, po.status === "Accruing" ? "This payout isn't earned yet." : `This payout is already ${po.status.toLowerCase()}.`);
    const over = po.flow === "IB" && (await P.exceedsCashReceived(client, po.vehicle_id, po.id, po.amount));
    if (over && !reason && !po.over_cash_reason) throw httpError(400, "This payout is more than the cash fee RIV has received on this deal. Give a reason to approve it.");
    const threshold = await P.secondAdminThreshold(client);
    const needsTwo = Number(po.total) > threshold;
    if (needsTwo && po.first_approved_by === req.user.id) throw httpError(403, "You've already approved this. A second admin must approve it.");
    const complete = !needsTwo || Boolean(po.first_approved_by);
    const { rows: updated } = await client.query(
      `UPDATE partner_payouts SET over_cash_flag = $2, over_cash_reason = coalesce($3, over_cash_reason),
         first_approved_by = coalesce(first_approved_by, $4), first_approved_at = coalesce(first_approved_at, now()),
         approved_by = CASE WHEN $5 THEN $4::int END, approved_at = CASE WHEN $5 THEN now() END,
         status = CASE WHEN $5 THEN 'Approved' ELSE status END, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, over, reason, req.user.id, complete]
    );
    await logAudit({ actorId: req.user.id, action: complete ? "payout.approved" : "payout.first_approval", objectType: "payout", objectId: id, details: { total: po.total, ...(over ? { over_cash: reason || po.over_cash_reason } : {}) }, req }, client);
    return updated[0];
  });
  res.json({ payout });
}));

router.post("/payouts/:id/pay", receiveFile, asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "payout");
  const valueDate = v.date(req.body?.value_date, "Payment date", { required: true });
  const reference = v.text(req.body?.payment_reference, "Payment reference", { required: true, max: 200 });
  const payout = await inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT po.*, p.full_name FROM partner_payouts po JOIN venture_partners p ON p.id = po.partner_id WHERE po.id = $1 FOR UPDATE OF po`, [id]
    );
    const po = rows[0];
    if (!po) throw httpError(404, "Payout not found.");
    if (po.status !== "Approved") throw httpError(400, "Approve the payout before paying it.");
    const proof = await saveDocument(client, {
      file: req.file, docType: "Bank proof", title: `Partner payout ${reference}`, linkedType: "payout", linkedId: id,
      confidentiality: "Internal", source: "Admin upload", uploadedBy: req.user.id,
    });
    // Payouts go out of the Retail X HoldCo account (MON-2).
    await client.query(
      `INSERT INTO money_movements (direction, type, commitment_id, vehicle_id, payout_id, amount, value_date, counterparty, bank_reference, proof_document_id, recorded_by)
       VALUES ('Out', 'Partner payout', $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [po.commitment_id, await holdCoVehicleId(client), id, po.total, valueDate, po.full_name, reference, proof.id, req.user.id]
    );
    const { rows: updated } = await client.query(
      // Noon, so the payment date reads the same in any time zone.
      "UPDATE partner_payouts SET status = 'Paid', paid_at = $3::date + time '12:00', payment_reference = $2, updated_at = now() WHERE id = $1 RETURNING *", [id, reference, valueDate]
    );
    await logAudit({ actorId: req.user.id, action: "payout.paid", objectType: "payout", objectId: id, details: { total: po.total, reference }, req }, client);
    await notifyPartner(client, po.partner_id, {
      type: "payout", title: `Payout paid: USD ${Number(po.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, body: `Reference ${reference}.`, linkView: "payouts", email: true, emailSubject: "RICap: your payout has been paid",
    });
    return updated[0];
  });
  res.json({ payout });
}));

router.post("/payouts/:id/cancel", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "payout");
  const reason = v.text(req.body?.reason, "Reason", { required: true, max: 1000 });
  const { rows } = await pool.query(
    `UPDATE partner_payouts SET status = 'Cancelled', cancel_reason = $2, cancelled_manually = true, updated_at = now()
     WHERE id = $1 AND status <> 'Paid' RETURNING id`, [id, reason]
  );
  if (!rows[0]) throw httpError(400, "A paid payout can't be cancelled.");
  await logAudit({ actorId: req.user.id, action: "payout.cancelled", objectType: "payout", objectId: id, details: { reason }, req });
  res.json({ ok: true });
}));

// ---------- outbound investments (BIZ-5) ----------
function readOutbound(b, { partial }) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k) || (!partial && ["startup_name", "instrument", "amount"].includes(k));
  if (has("startup_name")) out.startup_name = v.text(b.startup_name, "Startup", { required: true, max: 200 });
  if (has("rise_startup_id")) out.rise_startup_id = v.text(b.rise_startup_id, "RISE startup ID", { max: 100 });
  if (has("instrument")) out.instrument = v.oneOf(b.instrument, ["Equity", "SAFE", "Convertible", "Other"], "Instrument", { required: true });
  if (has("amount")) out.amount = v.number(b.amount, "Amount", { required: true, min: 1, max: 1e12 });
  if (has("investment_date")) out.investment_date = v.date(b.investment_date, "Investment date");
  if (has("stake_pct")) out.stake_pct = v.number(b.stake_pct, "Stake %", { min: 0, max: 100 });
  if (has("valuation")) out.valuation = v.number(b.valuation, "Valuation", { min: 1, max: 1e13 });
  if (has("notes")) out.notes = v.text(b.notes, "Notes", { max: 4000 });
  return out;
}

router.get("/outbound", asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.*, pu.name AS proposed_by_name, au.name AS approved_by_name
     FROM outbound_investments o LEFT JOIN users pu ON pu.id = o.proposed_by LEFT JOIN users au ON au.id = o.approved_by
     ORDER BY o.created_at DESC`
  );
  const deployed = rows.filter((o) => ["Funded", "Exited", "Written off"].includes(o.status)).reduce((s, o) => s + Number(o.amount), 0);
  res.json({ investments: rows, deployed });
}));

router.post("/outbound", asyncRoute(async (req, res) => {
  const o = readOutbound(req.body || {}, { partial: false });
  const cols = Object.keys(o);
  const investment = await inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO outbound_investments (${cols.join(", ")}, proposed_by) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, $${cols.length + 1}) RETURNING *`,
      [...cols.map((c) => o[c]), req.user.id]
    );
    await logAudit({ actorId: req.user.id, action: "outbound.proposed", objectType: "outbound", objectId: rows[0].id, details: { startup: o.startup_name, amount: o.amount }, req }, client);
    return rows[0];
  });
  res.status(201).json({ investment });
}));

router.patch("/outbound/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "investment");
  const o = readOutbound(req.body || {}, { partial: true });
  const cols = Object.keys(o);
  if (!cols.length) throw httpError(400, "Nothing to change.");
  const investment = await inTransaction(pool, async (client) => {
    const { rows: cur } = await client.query("SELECT status FROM outbound_investments WHERE id = $1 FOR UPDATE", [id]);
    if (!cur[0]) throw httpError(404, "Investment not found.");
    if (cur[0].status !== "Proposed" && (o.amount !== undefined || o.startup_name)) throw httpError(400, "Startup and amount are fixed once approved.");
    const { rows } = await client.query(
      `UPDATE outbound_investments SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...cols.map((c) => o[c])]
    );
    await logAudit({ actorId: req.user.id, action: "outbound.updated", objectType: "outbound", objectId: id, details: { fields: cols.join(", ") }, req }, client);
    return rows[0];
  });
  res.json({ investment });
}));

router.post("/outbound/:id/approve", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "investment");
  const { rows } = await pool.query(
    "UPDATE outbound_investments SET status = 'Approved', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1 AND status = 'Proposed' RETURNING *",
    [id, req.user.id]
  );
  if (!rows[0]) throw httpError(400, "Only a proposed investment can be approved.");
  await logAudit({ actorId: req.user.id, action: "outbound.approved", objectType: "outbound", objectId: id, details: { startup: rows[0].startup_name, amount: rows[0].amount }, req });
  res.json({ investment: rows[0] });
}));

router.post("/outbound/:id/fund", receiveFile, asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "investment");
  const valueDate = v.date(req.body?.value_date, "Payment date", { required: true });
  const reference = v.text(req.body?.bank_reference, "Bank reference", { required: true, max: 200 });
  const investment = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM outbound_investments WHERE id = $1 FOR UPDATE", [id]);
    const o = rows[0];
    if (!o) throw httpError(404, "Investment not found.");
    if (o.status !== "Approved") throw httpError(400, "Approve the investment before funding it.");
    const proof = await saveDocument(client, {
      file: req.file, docType: "Bank proof", title: `Investment in ${o.startup_name}`, linkedType: "outbound", linkedId: id,
      confidentiality: "Internal", source: "Admin upload", uploadedBy: req.user.id,
    });
    await client.query(
      `INSERT INTO money_movements (direction, type, vehicle_id, outbound_investment_id, amount, value_date, counterparty, bank_reference, proof_document_id, recorded_by)
       VALUES ('Out', 'Outbound investment', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [await holdCoVehicleId(client), id, o.amount, valueDate, o.startup_name, reference, proof.id, req.user.id]
    );
    const { rows: updated } = await client.query(
      "UPDATE outbound_investments SET status = 'Funded', investment_date = coalesce(investment_date, $2), updated_at = now() WHERE id = $1 RETURNING *", [id, valueDate]
    );
    await logAudit({ actorId: req.user.id, action: "outbound.funded", objectType: "outbound", objectId: id, details: { amount: o.amount, reference }, req }, client);
    return updated[0];
  });
  res.json({ investment });
}));

// Funded -> Exited / Written off; Proposed or Approved -> Cancelled.
router.post("/outbound/:id/status", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "investment");
  const status = v.oneOf(req.body?.status, ["Exited", "Written off", "Cancelled"], "Status", { required: true });
  const reason = v.text(req.body?.reason, "Reason", { required: true, max: 1000 });
  const investment = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT status FROM outbound_investments WHERE id = $1 FOR UPDATE", [id]);
    if (!rows[0]) throw httpError(404, "Investment not found.");
    const allowed = status === "Cancelled" ? ["Proposed", "Approved"] : ["Funded"];
    if (!allowed.includes(rows[0].status)) throw httpError(400, `A ${rows[0].status.toLowerCase()} investment can't become ${status.toLowerCase()}.`);
    const { rows: updated } = await client.query(
      "UPDATE outbound_investments SET status = $2, status_reason = $3, updated_at = now() WHERE id = $1 RETURNING *", [id, status, reason]
    );
    await logAudit({ actorId: req.user.id, action: "outbound.status_changed", objectType: "outbound", objectId: id, details: { status, reason }, req }, client);
    return updated[0];
  });
  res.json({ investment });
}));

// ---------- settings ----------
router.get("/settings", asyncRoute(async (req, res) => {
  res.json({ payout_second_admin_above: await P.secondAdminThreshold(pool) });
}));

router.patch("/settings", asyncRoute(async (req, res) => {
  const value = v.number(req.body?.payout_second_admin_above, "Amount", { required: true, min: 0, max: 1e12 });
  await pool.query("UPDATE app_settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = 'payout_second_admin_above'", [value, req.user.id]);
  await logAudit({ actorId: req.user.id, action: "settings.updated", objectType: "settings", objectId: "payout_second_admin_above", details: { value }, req });
  res.json({ payout_second_admin_above: value });
}));

module.exports = router;
