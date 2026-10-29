// IB deal rules (PRD 6.8, 7, BIZ-3, VP-1): the deal floor, sweat-equity
// value, fee arithmetic and the deal's own stages.
const { httpError } = require("./http.js");

const FLOOR = 500000; // smallest round RIV takes without a recorded reason
const PREFERRED = 2000000; // below this, RIV also takes sweat equity
const DEAL_STAGES = ["Sourced", "Mandate signed", "Live"];
const VEHICLE_STATUS_FOR_DEAL = { Sourced: "Draft", "Mandate signed": "Draft", Live: "Open", Closed: "Closed", Withdrawn: "Closed" };

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// pg returns DATE columns as local-midnight Date objects; compare dates as
// YYYY-MM-DD strings instead.
function isoDate(d) {
  if (!d) return null;
  if (!(d instanceof Date)) return String(d).slice(0, 10);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Deal floor (BIZ-3, PRD 7): USD 2M+ preferred; below 2M only with
// additional sweat equity for RIV; below the USD 500K floor only with a
// reason recorded on the deal.
function floorProblems(d) {
  const problems = [];
  const size = Number(d.round_size);
  if (size < PREFERRED && !(Number(d.sweat_equity_pct) > 0)) {
    problems.push("Rounds under USD 2M need sweat equity for RIV. Enter the sweat-equity stake.");
  }
  if (size < FLOOR && !d.below_floor_reason) {
    problems.push("Rounds under USD 500K need a reason recorded on the deal.");
  }
  return problems;
}

// RIV's total IB consideration (BIZ-3, VP-1) = cash fee + sweat equity,
// with sweat equity valued at the round's pre-money valuation.
function consideration(d, capitalPlaced) {
  const cashFee = round2((Number(capitalPlaced) * Number(d.fee_pct)) / 100);
  const sweatValue = round2((Number(d.sweat_equity_pct) / 100) * Number(d.pre_money_valuation));
  return { capital_placed: round2(capitalPlaced), cash_fee: cashFee, sweat_equity_value: sweatValue, total: round2(cashFee + sweatValue) };
}

function invoiceAmounts(capitalPlaced, feePct, vatPct) {
  const fee = round2((Number(capitalPlaced) * Number(feePct)) / 100);
  const vat = round2((fee * Number(vatPct)) / 100);
  return { fee_amount: fee, vat_amount: vat, total: round2(fee + vat) };
}

async function loadDeal(db, vehicleId, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT d.*, v.name, v.summary, v.legal_entity, v.status AS vehicle_status, v.visible_to_partners, v.visible_to_investors
     FROM ib_deals d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.vehicle_id = $1 ${lock ? "FOR UPDATE OF d" : ""}`,
    [vehicleId]
  );
  if (!rows[0]) throw httpError(404, "Deal not found.");
  return rows[0];
}

// Documents the next deal stage needs (stage_requirements flow 'IB deal'),
// matched against documents on the deal's vehicle tagged for that stage.
async function dealEvidence(db, deal, stage) {
  const { rows: reqs } = await db.query(
    "SELECT id, label, doc_type FROM stage_requirements WHERE flow = 'IB deal' AND stage = $1 AND required ORDER BY sort_order, id",
    [stage]
  );
  const { rows: docs } = await db.query(
    `SELECT id, doc_type, title, filename, uploaded_at FROM documents
     WHERE linked_type = 'vehicle' AND linked_id = $1 AND evidence_stage = $2 AND voided_at IS NULL`,
    [deal.vehicle_id, stage]
  );
  return reqs.map((r) => {
    const matching = docs.filter((d) => d.doc_type === r.doc_type);
    return { ...r, met: matching.length > 0, documents: matching };
  });
}

// Investors can only commit to a Live deal (PRD 6.8.1 stage 3).
async function assertDealLive(db, vehicle) {
  const { rows } = await db.query("SELECT deal_status FROM ib_deals WHERE vehicle_id = $1", [vehicle.id]);
  if (rows[0]?.deal_status !== "Live") throw httpError(400, `${vehicle.name} isn't live for investors.`);
}

module.exports = {
  FLOOR, PREFERRED, DEAL_STAGES, VEHICLE_STATUS_FOR_DEAL, floorProblems, consideration, invoiceAmounts, loadDeal, dealEvidence, assertDealLive, round2, isoDate,
};
