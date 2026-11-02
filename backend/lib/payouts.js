// Partner payouts (PRD 6.9, 7, 8.12; VP-1, VP-2, LEG-11).
//
// Every credited commitment has one payout row:
//   Accruing -> Earned -> Approved -> Paid (or Cancelled)
// While Accruing the amount is an estimate from the partner's current
// terms. Once Earned, rate and amounts are frozen.
//
//   HoldCo / Fund: pct of capital raised, earned when the investor's money
//                  is received. The Fund takes no money in v1, so Fund
//                  payouts only ever accrue.
//   IB:            pct of RIV's consideration on the placement, earned when
//                  RIV receives its cash fee.
const { httpError } = require("./http.js");
const { round2 } = require("./deals.js");
const { logAudit } = require("./audit.js");
const { notifyPartner, notifyAdmins } = require("./notify.js");

function vatFor(amount, vatPct) {
  const vat = round2((Number(amount) * Number(vatPct)) / 100);
  return { vat_amount: vat, total: round2(Number(amount) + vat) };
}

// IB consideration on one placement: the cash fee on its capital, plus the
// placement's share of the deal's sweat-equity value. The share is capital
// placed / RIV's allocation (or the round), capped at 100%, so it can't
// change as other investors join later.
function ibConsideration(deal, capital) {
  const cash = round2((Number(capital) * Number(deal.fee_pct)) / 100);
  const sweatTotal = (Number(deal.sweat_equity_pct) / 100) * Number(deal.pre_money_valuation);
  const allocation = Number(deal.riv_allocation || deal.round_size);
  const sweat = round2(sweatTotal * Math.min(1, Number(capital) / allocation));
  return { cash, sweat, basis: round2(cash + sweat) };
}

async function computeTerms(db, c, partner) {
  if (c.flow === "IB") {
    const { rows } = await db.query("SELECT * FROM ib_deals WHERE vehicle_id = $1", [c.vehicle_id]);
    const capital = c.funds_transferred_amount ?? c.committed_amount ?? c.indicative_amount;
    const k = ibConsideration(rows[0], capital);
    return { basis: k.basis, cash: k.cash, sweat: k.sweat, pct: Number(partner.payout_ib_pct) };
  }
  const pct = Number(c.flow === "HoldCo" ? partner.payout_holdco_pct : partner.payout_fund_pct);
  return { basis: Number(c.committed_amount ?? c.indicative_amount), cash: null, sweat: null, pct };
}

async function isEarned(db, c) {
  if (c.flow === "HoldCo") return ["Funds received", "Shares issued", "Active shareholder"].includes(c.stage);
  if (c.flow === "IB" && c.invoice_id) {
    const { rows } = await db.query("SELECT status FROM fee_invoices WHERE id = $1", [c.invoice_id]);
    return rows[0]?.status === "Paid";
  }
  return false;
}

// Would this deal's partner payouts (with this amount) exceed the cash fees
// RIV has actually received on it? (VP-1)
async function exceedsCashReceived(db, vehicleId, payoutId, amount) {
  const { rows } = await db.query(
    `SELECT
       coalesce((SELECT sum(fee_amount) FROM fee_invoices WHERE vehicle_id = $1 AND status = 'Paid'), 0) AS cash,
       coalesce((SELECT sum(amount) FROM partner_payouts WHERE vehicle_id = $1 AND status IN ('Earned', 'Approved', 'Paid') AND id IS DISTINCT FROM $2), 0) AS others`,
    [vehicleId, payoutId]
  );
  return Number(rows[0].others) + Number(amount) > Number(rows[0].cash);
}

// Brings a commitment's payout in line with the commitment. Call after
// anything that can change it. Paid and manually cancelled payouts are left
// alone. Returns the payout, or null if no partner is credited.
async function refreshPayout(db, commitmentId, { actorId = null, req = null } = {}) {
  const { loadCommitment } = require("./commitments.js");
  const c = await loadCommitment(db, commitmentId);
  if (!c.partner_id) return null;
  const { rows: partners } = await db.query("SELECT * FROM venture_partners WHERE id = $1", [c.partner_id]);
  const partner = partners[0];
  if (!partner) return null;
  const { rows: existing } = await db.query("SELECT * FROM partner_payouts WHERE commitment_id = $1 FOR UPDATE", [commitmentId]);
  const row = existing[0];
  if (row && (row.status === "Paid" || row.cancelled_manually)) return row;

  // Commitment has exited: cancel (it revives if the commitment is reopened).
  if (["Dropped", "Rejected", "Withdrawn"].includes(c.status)) {
    if (!row || row.status === "Cancelled") return row || null;
    const { rows } = await db.query(
      "UPDATE partner_payouts SET status = 'Cancelled', cancel_reason = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [row.id, `Commitment ${c.status.toLowerCase()}`]
    );
    await logAudit({ actorId, action: "payout.cancelled", objectType: "payout", objectId: row.id, details: { reason: `Commitment ${c.status.toLowerCase()}` }, req }, db);
    return rows[0];
  }

  const earned = await isEarned(db, c);
  // Already earned or approved and still earned: frozen.
  if (earned && row && ["Earned", "Approved"].includes(row.status)) return row;

  const t = await computeTerms(db, c, partner);
  const amount = round2((t.basis * t.pct) / 100);
  const v = vatFor(amount, partner.payout_vat_pct);
  const status = earned ? "Earned" : "Accruing";
  const overCash = earned && c.flow === "IB" ? await exceedsCashReceived(db, c.vehicle_id, row?.id ?? null, amount) : false;

  const { rows } = await db.query(
    `INSERT INTO partner_payouts (partner_id, commitment_id, vehicle_id, flow, status, basis_amount, cash_fee_part, sweat_value_part, pct, amount, vat_pct, vat_amount, total, over_cash_flag, earned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CASE WHEN $5 = 'Earned' THEN now() END)
     ON CONFLICT (commitment_id) DO UPDATE SET
       partner_id = EXCLUDED.partner_id, status = EXCLUDED.status, basis_amount = EXCLUDED.basis_amount,
       cash_fee_part = EXCLUDED.cash_fee_part, sweat_value_part = EXCLUDED.sweat_value_part, pct = EXCLUDED.pct,
       amount = EXCLUDED.amount, vat_pct = EXCLUDED.vat_pct, vat_amount = EXCLUDED.vat_amount, total = EXCLUDED.total,
       over_cash_flag = EXCLUDED.over_cash_flag, over_cash_reason = NULL, earned_at = EXCLUDED.earned_at,
       first_approved_by = NULL, first_approved_at = NULL, approved_by = NULL, approved_at = NULL,
       cancel_reason = NULL, updated_at = now()
     RETURNING *`,
    [c.partner_id, commitmentId, c.vehicle_id, c.flow, status, t.basis, t.cash, t.sweat, t.pct, amount, partner.payout_vat_pct, v.vat_amount, v.total, overCash]
  );
  if (status === "Earned" && row?.status !== "Earned") {
    await logAudit({ actorId, action: "payout.earned", objectType: "payout", objectId: rows[0].id, details: { partner: partner.full_name, amount, flow: c.flow }, req }, db);
    await onPayoutEarned(db, partner, rows[0], c);
  } else if (row && ["Earned", "Approved"].includes(row.status) && status === "Accruing") {
    await logAudit({ actorId, action: "payout.back_to_accruing", objectType: "payout", objectId: row.id, details: { was: row.status }, req }, db);
  }
  return rows[0];
}

async function onPayoutEarned(db, partner, row, c) {
  await notifyPartner(db, partner.id, {
    type: "payout", title: `Payout earned: USD ${Number(row.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, body: `${c.investor_name}, ${c.vehicle_name}. RIV will approve and pay it.`,
    linkView: "payouts", email: true, emailSubject: "RICap: you've earned a payout",
  });
  await notifyAdmins(db, {
    type: "payout_admin", title: `Payout to approve: ${partner.full_name}`, body: `USD ${Number(row.total).toLocaleString("en-US", { minimumFractionDigits: 2 })} on ${c.investor_name}, ${c.vehicle_name}.`, linkView: "money",
  });
}

async function secondAdminThreshold(db) {
  const { rows } = await db.query("SELECT value FROM app_settings WHERE key = 'payout_second_admin_above'");
  return rows[0] ? Number(rows[0].value) : Infinity;
}

// Blocks undoing a receipt or fee payment that a paid payout depends on.
async function assertNoPaidPayout(db, commitmentIds) {
  const { rows } = await db.query("SELECT id FROM partner_payouts WHERE commitment_id = ANY($1) AND status = 'Paid'", [commitmentIds]);
  if (rows[0]) throw httpError(400, "A partner payout on this has already been paid. Void that payment first.");
}

module.exports = { refreshPayout, ibConsideration, vatFor, exceedsCashReceived, secondAdminThreshold, assertNoPaidPayout };
