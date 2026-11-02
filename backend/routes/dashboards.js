// Admin dashboards (PRD 6.11, 6.12): home, compliance and money views, all
// worked out live from the records. Mounted at /api/admin/dashboard; admin only.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute } = require("../lib/http.js");
const v = require("../lib/validate.js");
const { hasRestrictedAccess } = require("../lib/identity.js");
const E = require("../lib/commitments.js");

const router = Router();
router.use(requireAuth, requireAdmin);

const LIVE = "c.status IN ('Active', 'On hold')";
const DEFAULT_STUCK_DAYS = 14;
const KYC_EXPIRING_DAYS = 60;

// What's been paid per commitment: receipts into RIV's account, or for IB
// deals the amount paid straight to the startup (MON-1).
const PAID_SQL = `(coalesce((SELECT sum(m.amount) FROM money_movements m
    WHERE m.commitment_id = c.id AND m.type = 'Subscription payment' AND m.voided_at IS NULL), 0)
  + coalesce(c.funds_transferred_amount, 0))`;

async function capital(db) {
  const { rows } = await db.query(
    `SELECT v.id, v.type, v.name, v.status, d.deal_status,
            coalesce(v.target_raise, d.riv_allocation, d.round_size) AS target_raise,
            count(c.id) FILTER (WHERE ${LIVE})::int AS live_count,
            count(DISTINCT c.investor_id) FILTER (WHERE ${LIVE})::int AS investors,
            coalesce(sum(c.indicative_amount) FILTER (WHERE ${LIVE}), 0) AS indicative_total,
            coalesce(sum(c.indicative_amount) FILTER (WHERE ${LIVE} AND c.soft_confirmed_at IS NOT NULL), 0) AS soft_confirmed_total,
            coalesce(sum(c.committed_amount) FILTER (WHERE ${LIVE}), 0) AS committed_total,
            coalesce(sum(${PAID_SQL}), 0) AS received_total,
            coalesce(sum(greatest(0, c.committed_amount - ${PAID_SQL})) FILTER (WHERE ${LIVE}), 0) AS outstanding_total,
            coalesce(sum(coalesce(c.committed_amount, c.indicative_amount)) FILTER (WHERE ${LIVE}), 0) AS current_total
     FROM vehicles v
     LEFT JOIN ib_deals d ON d.vehicle_id = v.id
     LEFT JOIN commitments c ON c.vehicle_id = v.id
     GROUP BY v.id, d.vehicle_id
     ORDER BY CASE v.type WHEN 'HoldCo' THEN 0 WHEN 'Fund' THEN 1 ELSE 2 END, v.id`
  );
  return rows;
}

async function funnel(db) {
  const { rows } = await db.query(
    `SELECT c.flow, c.stage, count(*)::int AS count, sum(coalesce(c.committed_amount, c.indicative_amount)) AS amount
     FROM commitments c WHERE ${LIVE} GROUP BY c.flow, c.stage`
  );
  const out = {};
  for (const flow of Object.keys(E.FLOWS)) {
    out[flow] = E.FLOWS[flow].map((stage) => {
      const r = rows.find((x) => x.flow === flow && x.stage === stage);
      return { stage, count: r?.count || 0, amount: r?.amount || 0 };
    });
  }
  return out;
}

// Active commitments that haven't changed stage in more than N days. Notes
// don't count as movement; the last stage of a flow isn't stuck.
async function stuck(db, days) {
  const lastStages = Object.values(E.FLOWS).map((s) => s[s.length - 1]);
  const { rows } = await db.query(
    `SELECT c.id, c.flow, c.stage, coalesce(i.display_name, i.legal_name) AS investor_name, v.name AS vehicle_name,
            current_date - max(e.created_at)::date AS days
     FROM commitments c
     JOIN investors i ON i.id = c.investor_id
     JOIN vehicles v ON v.id = c.vehicle_id
     JOIN commitment_events e ON e.commitment_id = c.id AND (e.to_stage IS NOT NULL OR e.to_status IS NOT NULL)
     WHERE c.status = 'Active' AND NOT (c.stage = ANY($1))
     GROUP BY c.id, i.id, v.id
     HAVING current_date - max(e.created_at)::date > $2
     ORDER BY days DESC`,
    [lastStages, days]
  );
  return rows;
}

const SCHEDULE_SQL = `
  SELECT c.id AS commitment_id, coalesce(i.display_name, i.legal_name) AS investor_name, v.id AS vehicle_id, v.name AS vehicle_name,
         pi.due_date, pi.amount AS instructed, ${PAID_SQL} AS received,
         greatest(0, c.committed_amount - ${PAID_SQL}) AS outstanding,
         greatest(0, current_date - pi.due_date) AS days_overdue,
         (pi.bank_iban <> v.bank_iban) AS old_account
  FROM payment_instructions pi
  JOIN commitments c ON c.id = pi.commitment_id
  JOIN investors i ON i.id = c.investor_id
  JOIN vehicles v ON v.id = c.vehicle_id
  WHERE pi.voided_at IS NULL AND c.status = 'Active' AND c.stage = 'Funds due'`;

async function fees(db) {
  const { rows } = await db.query(
    `SELECT coalesce(sum(fee_amount) FILTER (WHERE status IN ('Sent', 'Paid')), 0) AS invoiced,
            coalesce(sum(fee_amount) FILTER (WHERE status = 'Paid'), 0) AS received,
            coalesce(sum(fee_amount) FILTER (WHERE status = 'Sent'), 0) AS due,
            coalesce(sum(fee_amount) FILTER (WHERE status = 'Sent' AND due_date < current_date), 0) AS overdue
     FROM fee_invoices`
  );
  return rows[0];
}

async function payoutTotals(db) {
  const { rows } = await db.query(
    `SELECT coalesce(sum(total) FILTER (WHERE status = 'Accruing'), 0) AS accruing,
            coalesce(sum(total) FILTER (WHERE status = 'Earned'), 0) AS earned,
            coalesce(sum(total) FILTER (WHERE status = 'Approved'), 0) AS approved,
            coalesce(sum(total) FILTER (WHERE status = 'Paid'), 0) AS paid,
            count(*) FILTER (WHERE status = 'Earned')::int AS to_approve
     FROM partner_payouts`
  );
  return rows[0];
}

// Capital sourced is money actually in. Conversion is registration to funds
// (PRD 11): investors with money in, out of those the partner registered.
async function leaderboard(db) {
  const { rows } = await db.query(
    `SELECT p.id, p.full_name, p.company,
            (SELECT count(*)::int FROM investors i WHERE i.partner_id = p.id AND i.registration_status <> 'Duplicate') AS registered,
            coalesce(s.committed, 0) AS committed, coalesce(s.sourced, 0) AS sourced, coalesce(s.funded, 0)::int AS funded
     FROM venture_partners p
     LEFT JOIN (
       SELECT c.partner_id,
              sum(c.committed_amount) FILTER (WHERE ${LIVE}) AS committed,
              sum(${PAID_SQL}) AS sourced,
              count(DISTINCT c.investor_id) FILTER (WHERE ${PAID_SQL} > 0) AS funded
       FROM commitments c WHERE c.partner_id IS NOT NULL GROUP BY c.partner_id
     ) s ON s.partner_id = p.id
     ORDER BY sourced DESC, committed DESC, registered DESC, p.full_name
     LIMIT 10`
  );
  return rows.map((r) => ({ ...r, conversion: r.registered ? r.funded / r.registered : 0 }));
}

async function kycFiles(db) {
  const { rows } = await db.query(
    `SELECT f.id, f.investor_id, coalesce(i.display_name, i.legal_name) AS investor_name, f.kyc_type, f.status, f.risk_rating, f.refresh_due,
            current_date - coalesce(f.submitted_at, f.created_at)::date AS age_days,
            (f.status = 'Cleared' AND f.refresh_due < current_date) AS expired,
            (f.status = 'Cleared' AND f.refresh_due >= current_date AND f.refresh_due <= current_date + $1::int) AS expiring
     FROM kyc_files f JOIN investors i ON i.id = f.investor_id
     WHERE f.is_current
     ORDER BY CASE f.status WHEN 'Submitted' THEN 0 WHEN 'Information requested' THEN 1 WHEN 'Open' THEN 2 ELSE 3 END, age_days DESC`,
    [KYC_EXPIRING_DAYS]
  );
  return rows;
}

router.get("/home", asyncRoute(async (req, res) => {
  const stuckDays = v.number(req.query.stuck_days, "Days", { min: 0, max: 3650, integer: true }) ?? DEFAULT_STUCK_DAYS;
  const restricted = await hasRestrictedAccess(req.user.id);
  const [vehicles, stages, stuckRows, overdue, feeTotals, payouts, partners, attention, outbound, people, kyc] = await Promise.all([
    capital(pool),
    funnel(pool),
    stuck(pool, stuckDays),
    pool.query(`${SCHEDULE_SQL} AND pi.due_date < current_date ORDER BY pi.due_date`).then((r) => r.rows),
    fees(pool),
    payoutTotals(pool),
    leaderboard(pool),
    pool.query(
      `SELECT (SELECT count(*)::int FROM investors WHERE registration_status = 'Submitted') AS registrations,
              (SELECT count(*)::int FROM commitments c WHERE c.stage = 'Intent' AND c.status = 'Active') AS waiting_eligibility,
              (SELECT count(*)::int FROM commitments c WHERE c.stage = 'Funds due' AND c.status = 'Active') AS funds_due,
              (SELECT count(*)::int FROM money_movements WHERE reconciled_at IS NULL AND voided_at IS NULL) AS unreconciled`
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT coalesce(sum(amount), 0) AS deployed, count(*)::int AS count, count(*) FILTER (WHERE status = 'Funded')::int AS held,
              (SELECT count(*)::int FROM outbound_investments WHERE status IN ('Proposed', 'Approved')) AS in_progress
       FROM outbound_investments WHERE status IN ('Funded', 'Exited', 'Written off')`
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT (SELECT count(*)::int FROM investors WHERE registration_status = 'Approved') AS approved_investors,
              (SELECT count(*)::int FROM venture_partners WHERE onboarding_stage = 'Onboarded') AS onboarded_partners,
              (SELECT count(*)::int FROM venture_partners WHERE onboarding_stage <> 'Onboarded' AND status = 'Active') AS onboarding_partners`
    ).then((r) => r.rows[0]),
    restricted ? kycFiles(pool) : null,
  ]);
  // Intelligence headline view (PRD 6.12).
  const dealsLive = vehicles.filter((x) => x.deal_status === "Live").length;
  const { rows: investorCount } = await pool.query(`SELECT count(DISTINCT c.investor_id)::int AS n FROM commitments c WHERE ${LIVE}`);
  res.json({
    vehicles, funnel: stages, stuck: stuckRows, stuck_days: stuckDays, overdue, fees: feeTotals, payouts, leaderboard: partners, attention, outbound, people,
    kyc: kyc && {
      submitted: kyc.filter((f) => f.status === "Submitted").length,
      expired: kyc.filter((f) => f.expired).length,
      expiring: kyc.filter((f) => f.expiring).length,
    },
    headline: {
      investors: investorCount[0].n, live_deals: dealsLive,
      current_commitments: vehicles.reduce((s, x) => s + Number(x.current_total), 0),
    },
  });
}));

router.get("/compliance", asyncRoute(async (req, res) => {
  const restricted = await hasRestrictedAccess(req.user.id);
  // Commitments with every required document in, waiting for someone to sign
  // the stage off.
  const { rows: active } = await pool.query("SELECT id FROM commitments WHERE status = 'Active' ORDER BY updated_at");
  const gates = [];
  for (const { id } of active) {
    const c = await E.loadCommitment(pool, id);
    const next = E.nextStage(c.flow, c.stage);
    if (!next || E.AUTOMATIC_STAGES.includes(next)) continue;
    const evidence = await E.evidenceFor(pool, c, next);
    if (evidence.length && evidence.every((e) => e.met)) {
      gates.push({ commitment_id: c.id, investor_name: c.investor_name, vehicle_name: c.vehicle_name, stage: c.stage, next_stage: next });
    }
  }
  // PRD 11: this list should always be empty. It fills up if KYC expires or
  // reopens after someone has moved on.
  const { rows: noKyc } = await pool.query(
    `SELECT c.id AS commitment_id, c.flow, c.stage, coalesce(i.display_name, i.legal_name) AS investor_name, v.name AS vehicle_name,
            CASE WHEN k.status = 'Cleared' THEN 'Expired' ELSE coalesce(k.status, 'Not started') END AS kyc_status
     FROM commitments c
     JOIN investors i ON i.id = c.investor_id
     JOIN vehicles v ON v.id = c.vehicle_id
     LEFT JOIN kyc_files k ON k.investor_id = i.id AND k.is_current
     WHERE c.status = 'Active' AND c.stage NOT IN ('Intent', 'Eligible')
       AND NOT coalesce(k.status = 'Cleared' AND k.refresh_due >= current_date, false)
     ORDER BY investor_name`
  );
  res.json({ restricted, kyc_files: restricted ? await kycFiles(pool) : null, gates, no_kyc: noKyc, expiring_days: KYC_EXPIRING_DAYS });
}));

router.get("/money", asyncRoute(async (req, res) => {
  const [vehicles, schedule, unreconciled, invoices, payouts, feeTotals, payoutSum] = await Promise.all([
    capital(pool),
    pool.query(`${SCHEDULE_SQL} ORDER BY pi.due_date`).then((r) => r.rows),
    pool.query(
      `SELECT m.id, m.direction, m.type, m.amount, m.value_date, m.bank_reference, coalesce(m.counterparty, coalesce(i.display_name, i.legal_name)) AS who
       FROM money_movements m
       LEFT JOIN commitments c ON c.id = m.commitment_id
       LEFT JOIN investors i ON i.id = c.investor_id
       WHERE m.reconciled_at IS NULL AND m.voided_at IS NULL
       ORDER BY m.value_date, m.id`
    ).then((r) => r.rows),
    pool.query(
      `SELECT f.id, f.invoice_number, f.vehicle_id, v.name AS vehicle_name, f.total, f.status, f.due_date, f.billed_to,
              greatest(0, current_date - f.due_date) AS days_overdue
       FROM fee_invoices f JOIN vehicles v ON v.id = f.vehicle_id
       WHERE f.status IN ('Draft', 'Sent') ORDER BY f.due_date`
    ).then((r) => r.rows),
    pool.query(
      `SELECT po.id, po.status, po.total, p.full_name AS partner_name, coalesce(i.display_name, i.legal_name) AS investor_name, v.name AS vehicle_name
       FROM partner_payouts po
       JOIN venture_partners p ON p.id = po.partner_id
       JOIN commitments c ON c.id = po.commitment_id
       JOIN investors i ON i.id = c.investor_id
       JOIN vehicles v ON v.id = po.vehicle_id
       WHERE po.status IN ('Earned', 'Approved') ORDER BY po.earned_at`
    ).then((r) => r.rows),
    fees(pool),
    payoutTotals(pool),
  ]);
  res.json({ vehicles, schedule, unreconciled, invoices, payouts, fees: feeTotals, payout_totals: payoutSum });
}));

module.exports = router;
