// HoldCo and Fund vehicles (PRD 8.4): settings, receiving bank account
// (two-admin approval, PRD 7) and the per-investor visibility switch
// (PRD 6.14). Mounted at /api/admin/vehicles; admin only.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const C = require("../lib/constants.js");
const { logAudit } = require("../lib/audit.js");

const router = Router();
router.use(requireAuth, requireAdmin);

// Capital per vehicle, counting live commitments only (Active / On hold).
const STATS_SQL = `
  SELECT v.*,
    coalesce(s.live_count, 0) AS live_count,
    coalesce(s.indicative_total, 0) AS indicative_total,
    coalesce(s.committed_total, 0) AS committed_total,
    coalesce(s.soft_confirmed_total, 0) AS soft_confirmed_total,
    coalesce(r.received_total, 0) AS received_total
  FROM vehicles v
  LEFT JOIN (
    SELECT vehicle_id, count(*)::int AS live_count,
           sum(indicative_amount) AS indicative_total,
           sum(committed_amount) FILTER (WHERE committed_amount IS NOT NULL) AS committed_total,
           sum(indicative_amount) FILTER (WHERE soft_confirmed_at IS NOT NULL) AS soft_confirmed_total
    FROM commitments WHERE status IN ('Active', 'On hold') GROUP BY vehicle_id
  ) s ON s.vehicle_id = v.id
  LEFT JOIN (
    SELECT c.vehicle_id, sum(m.amount) AS received_total
    FROM money_movements m JOIN commitments c ON c.id = m.commitment_id
    WHERE m.type = 'Subscription payment' AND m.voided_at IS NULL GROUP BY c.vehicle_id
  ) r ON r.vehicle_id = v.id`;

function maskIban(iban) {
  if (!iban) return null;
  const s = String(iban).replace(/\s+/g, "");
  return s.length <= 8 ? s : `${s.slice(0, 4)} •••• ${s.slice(-4)}`;
}

router.get("/", asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`${STATS_SQL} WHERE v.type IN ('HoldCo', 'Fund') ORDER BY v.id`);
  res.json({ vehicles: rows.map((r) => ({ ...r, bank_iban: maskIban(r.bank_iban) })) });
}));

router.get("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "vehicle");
  const { rows } = await pool.query(`${STATS_SQL} WHERE v.id = $1`, [id]);
  const vehicle = rows[0];
  if (!vehicle) throw httpError(404, "Vehicle not found.");
  const { rows: changes } = await pool.query(
    `SELECT b.*, pu.name AS proposed_by_name, du.name AS decided_by_name
     FROM bank_account_changes b JOIN users pu ON pu.id = b.proposed_by LEFT JOIN users du ON du.id = b.decided_by
     WHERE b.vehicle_id = $1 ORDER BY b.proposed_at DESC LIMIT 20`,
    [id]
  );
  const { rows: hidden } = await pool.query(
    `SELECT h.investor_id, coalesce(i.display_name, i.legal_name) AS investor_name, h.created_at, u.name AS hidden_by_name
     FROM vehicle_visibility h JOIN investors i ON i.id = h.investor_id LEFT JOIN users u ON u.id = h.hidden_by
     WHERE h.vehicle_id = $1 ORDER BY investor_name`,
    [id]
  );
  // Full account details are shown here so admins can verify a proposal
  // against the current account before approving.
  res.json({ vehicle, bank_changes: changes, hidden_investors: hidden });
}));

router.patch("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "vehicle");
  const b = req.body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const f = {};
  if (has("name")) f.name = v.text(b.name, "Name", { required: true, max: 200 });
  if (has("status")) f.status = v.oneOf(b.status, ["Draft", "Open", "Closed"], "Status", { required: true });
  if (has("target_raise")) f.target_raise = v.number(b.target_raise, "Target raise", { min: 1, max: 1e12 });
  if (has("pre_money_valuation")) f.pre_money_valuation = v.number(b.pre_money_valuation, "Pre-money valuation", { min: 1, max: 1e13 });
  if (has("min_ticket_individual")) f.min_ticket_individual = v.number(b.min_ticket_individual, "Minimum ticket (individuals)", { min: 0, max: 1e12 });
  if (has("min_ticket_entity")) f.min_ticket_entity = v.number(b.min_ticket_entity, "Minimum ticket (entities)", { min: 0, max: 1e12 });
  if (has("eligible_classifications")) f.eligible_classifications = v.manyOf(b.eligible_classifications, C.CLASSIFICATIONS, "Eligible classifications");
  if (has("summary")) f.summary = v.text(b.summary, "Summary", { max: 4000 });
  if (has("visible_to_partners")) f.visible_to_partners = v.bool(b.visible_to_partners);
  if (has("visible_to_investors")) f.visible_to_investors = v.bool(b.visible_to_investors);
  const cols = Object.keys(f);
  if (!cols.length) throw httpError(400, "Nothing to change.");
  const vehicle = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT type FROM vehicles WHERE id = $1 FOR UPDATE", [id]);
    if (!rows[0]) throw httpError(404, "Vehicle not found.");
    if (rows[0].type === "IB Deal") throw httpError(400, "Edit IB deals on the IB deals page.");
    const { rows: updated } = await client.query(
      `UPDATE vehicles SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...cols.map((c) => f[c])]
    );
    await logAudit({ actorId: req.user.id, action: "vehicle.updated", objectType: "vehicle", objectId: id, details: { fields: cols.join(", ") }, req }, client);
    return updated[0];
  });
  res.json({ vehicle: { ...vehicle, bank_iban: maskIban(vehicle.bank_iban) } });
}));

// ---------- receiving bank account: propose, then a second admin approves ----------
router.post("/:id/bank-changes", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "vehicle");
  const b = req.body || {};
  const change = {
    bank_name: v.text(b.bank_name, "Bank name", { required: true, max: 200 }),
    bank_account_name: v.text(b.bank_account_name, "Account name", { required: true, max: 200 }),
    bank_iban: v.text(b.bank_iban, "IBAN", { required: true, max: 60 }).replace(/\s+/g, "").toUpperCase(),
    bank_swift: v.text(b.bank_swift, "SWIFT / BIC", { required: true, max: 20 }).replace(/\s+/g, "").toUpperCase(),
    reason: v.text(b.reason, "Reason", { max: 1000 }),
  };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(change.bank_iban)) throw httpError(400, "That doesn't look like an IBAN (e.g. AE07 0331 2345 6789 0123 456).");
  if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(change.bank_swift)) throw httpError(400, "SWIFT / BIC must be 8 or 11 letters and digits.");
  const proposal = await inTransaction(pool, async (client) => {
    const { rows: veh } = await client.query("SELECT id, name, type FROM vehicles WHERE id = $1", [id]);
    if (!veh[0]) throw httpError(404, "Vehicle not found.");
    if (veh[0].type === "IB Deal") throw httpError(400, "IB deal money goes straight to the startup (MON-1); deals have no receiving account.");
    let rows;
    try {
      ({ rows } = await client.query(
        `INSERT INTO bank_account_changes (vehicle_id, bank_name, bank_account_name, bank_iban, bank_swift, reason, proposed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, change.bank_name, change.bank_account_name, change.bank_iban, change.bank_swift, change.reason, req.user.id]
      ));
    } catch (err) {
      if (err.code === "23505") throw httpError(409, "There's already a pending change for this account. Approve, reject or cancel it first.");
      throw err;
    }
    await logAudit({ actorId: req.user.id, action: "vehicle.bank_change_proposed", objectType: "vehicle", objectId: id, details: { iban: maskIban(change.bank_iban) }, req }, client);
    return rows[0];
  });
  res.status(201).json({ change: proposal });
}));

router.post("/bank-changes/:changeId/:decision", asyncRoute(async (req, res) => {
  const changeId = v.id(req.params.changeId, "change");
  const decision = v.oneOf(req.params.decision, ["approve", "reject", "cancel"], "Decision", { required: true });
  const note = v.text(req.body?.note, "Note", { max: 1000 });
  const result = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM bank_account_changes WHERE id = $1 FOR UPDATE", [changeId]);
    const ch = rows[0];
    if (!ch) throw httpError(404, "Change not found.");
    if (ch.status !== "Pending") throw httpError(400, `This change is already ${ch.status.toLowerCase()}.`);
    if (decision === "cancel") {
      if (ch.proposed_by !== req.user.id) throw httpError(403, "Only the admin who proposed it can cancel it.");
    } else if (ch.proposed_by === req.user.id) {
      throw httpError(403, "A second admin must approve or reject this. You proposed it.");
    }
    const status = { approve: "Approved", reject: "Rejected", cancel: "Cancelled" }[decision];
    await client.query(
      "UPDATE bank_account_changes SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1",
      [changeId, status, decision === "cancel" ? null : req.user.id, note]
    );
    if (decision === "approve") {
      await client.query(
        `UPDATE vehicles SET bank_name = $2, bank_account_name = $3, bank_iban = $4, bank_swift = $5, bank_approved_at = now(), updated_at = now()
         WHERE id = $1`,
        [ch.vehicle_id, ch.bank_name, ch.bank_account_name, ch.bank_iban, ch.bank_swift]
      );
    }
    await logAudit({ actorId: req.user.id, action: `vehicle.bank_change_${status.toLowerCase()}`, objectType: "vehicle", objectId: ch.vehicle_id, details: { change: changeId }, req }, client);
    return status;
  });
  res.json({ status: result });
}));

// ---------- per-investor visibility ----------
router.post("/:id/hidden", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "vehicle");
  const investorId = v.id(req.body?.investor_id, "investor");
  await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT 1 FROM investors WHERE id = $1", [investorId]);
    if (!rows[0]) throw httpError(404, "Investor not found.");
    await client.query(
      "INSERT INTO vehicle_visibility (vehicle_id, investor_id, hidden_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [id, investorId, req.user.id]
    );
    await logAudit({ actorId: req.user.id, action: "vehicle.hidden_from_investor", objectType: "vehicle", objectId: id, details: { investor: investorId }, req }, client);
  });
  res.status(201).json({ ok: true });
}));

router.delete("/:id/hidden/:investorId", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "vehicle");
  const investorId = v.id(req.params.investorId, "investor");
  await pool.query("DELETE FROM vehicle_visibility WHERE vehicle_id = $1 AND investor_id = $2", [id, investorId]);
  await logAudit({ actorId: req.user.id, action: "vehicle.shown_to_investor", objectType: "vehicle", objectId: id, details: { investor: investorId }, req });
  res.json({ ok: true });
}));

module.exports = { router, STATS_SQL, maskIban };
