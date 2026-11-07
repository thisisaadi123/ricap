// Startup referrals from venture partners: the admin review queue and the
// IB deal draft opened from an accepted referral. Mounted at
// /api/admin/startup-referrals; admin only.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const { logAudit } = require("../lib/audit.js");
const { notifyPartner } = require("../lib/notify.js");
const D = require("../lib/deals.js");
const R = require("../lib/referrals.js");

const router = Router();
router.use(requireAuth, requireAdmin);

const LIST_SQL = `
  SELECT r.id, r.startup_name, r.website, r.sector, r.founder_name, r.status, r.created_at, r.credit_expires_at, r.deal_vehicle_id,
         p.full_name AS partner_name,
         (SELECT count(*)::int FROM startup_referrals o
          WHERE o.id <> r.id AND o.status <> 'Duplicate'
            AND (o.website_domain = r.website_domain OR ${R.NORM_SQL("o.startup_name")} = ${R.NORM_SQL("r.startup_name")} OR o.founder_email = r.founder_email))
         + (SELECT count(*)::int FROM ib_deals d
            WHERE d.vehicle_id IS DISTINCT FROM r.deal_vehicle_id
              AND (${R.NORM_SQL("d.startup_name")} = ${R.NORM_SQL("r.startup_name")} OR d.startup_contact_email = r.founder_email)) AS possible_duplicates
  FROM startup_referrals r JOIN venture_partners p ON p.id = r.partner_id`;

router.get("/", asyncRoute(async (req, res) => {
  const params = [];
  let where = "";
  if (req.query.status) {
    params.push(v.oneOf(req.query.status, R.REFERRAL_STATUSES, "Status"));
    where = "WHERE r.status = $1";
  }
  const { rows } = await pool.query(
    `${LIST_SQL} ${where} ORDER BY (r.status IN ('Submitted', 'Under review')) DESC, r.created_at DESC LIMIT 500`, params
  );
  res.json({ referrals: rows });
}));

async function loadReferral(db, id, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT r.*, p.full_name AS partner_name, p.company AS partner_company, p.email AS partner_email, p.credit_window_months,
            d.deal_status, vh.name AS deal_name, dup_r.startup_name AS duplicate_of_referral_name, dup_d.startup_name AS duplicate_of_deal_name
     FROM startup_referrals r
     JOIN venture_partners p ON p.id = r.partner_id
     LEFT JOIN ib_deals d ON d.vehicle_id = r.deal_vehicle_id
     LEFT JOIN vehicles vh ON vh.id = r.deal_vehicle_id
     LEFT JOIN startup_referrals dup_r ON dup_r.id = r.duplicate_of_referral_id
     LEFT JOIN ib_deals dup_d ON dup_d.vehicle_id = r.duplicate_of_deal_id
     WHERE r.id = $1 ${lock ? "FOR UPDATE OF r" : ""}`,
    [id]
  );
  if (!rows[0]) throw httpError(404, "Startup referral not found.");
  return rows[0];
}

router.get("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "referral");
  const referral = await loadReferral(pool, id);
  const duplicates = await R.findStartupDuplicates({ referralId: id, name: referral.startup_name, domain: referral.website_domain, founderEmail: referral.founder_email });
  res.json({ referral, duplicates });
}));

// Mark under review, accept, reject (reason needed) or mark as a duplicate of
// another referral or an IB deal. Accepting credits the partner for their
// credit window (VP-3). The partner is alerted to each decision; a duplicate
// is reported only as "not accepted".
router.post("/:id/review", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "referral");
  const decision = v.oneOf(req.body?.decision, ["under_review", "accept", "reject", "duplicate"], "Decision", { required: true });
  const reason = v.text(req.body?.reason, "Reason", { max: 2000 });
  const referral = await inTransaction(pool, async (client) => {
    const current = await loadReferral(client, id, { lock: true });
    if (!["Submitted", "Under review"].includes(current.status)) throw httpError(400, `This referral is already ${current.status.toLowerCase()}.`);
    if (decision === "under_review" && current.status !== "Submitted") throw httpError(400, "This referral is already under review.");

    if (decision === "under_review") {
      await client.query("UPDATE startup_referrals SET status = 'Under review', updated_at = now() WHERE id = $1", [id]);
    } else if (decision === "accept") {
      await client.query(
        `UPDATE startup_referrals SET status = 'Accepted', reviewed_by = $2, reviewed_at = now(),
           credit_expires_at = now() + make_interval(months => $3), updated_at = now() WHERE id = $1`,
        [id, req.user.id, current.credit_window_months ?? 12]
      );
    } else if (decision === "reject") {
      if (!reason) throw httpError(400, "Give a reason for rejecting.");
      await client.query(
        "UPDATE startup_referrals SET status = 'Rejected', rejection_reason = $3, reviewed_by = $2, reviewed_at = now(), updated_at = now() WHERE id = $1",
        [id, req.user.id, reason]
      );
    } else {
      const ofReferral = req.body?.duplicate_of_referral_id ? v.id(req.body.duplicate_of_referral_id, "existing referral") : null;
      const ofDeal = req.body?.duplicate_of_deal_id ? v.id(req.body.duplicate_of_deal_id, "existing deal") : null;
      if ((ofReferral === null) === (ofDeal === null)) throw httpError(400, "Pick the one existing referral or IB deal this duplicates.");
      if (ofReferral !== null) {
        if (ofReferral === id) throw httpError(400, "A referral can't be a duplicate of itself.");
        const { rows } = await client.query("SELECT status FROM startup_referrals WHERE id = $1", [ofReferral]);
        if (!rows[0] || rows[0].status === "Duplicate") throw httpError(400, "Pick an existing referral that isn't itself a duplicate.");
      } else {
        const { rows } = await client.query("SELECT 1 FROM ib_deals WHERE vehicle_id = $1", [ofDeal]);
        if (!rows[0]) throw httpError(400, "That IB deal doesn't exist.");
      }
      await client.query(
        `UPDATE startup_referrals SET status = 'Duplicate', duplicate_of_referral_id = $3, duplicate_of_deal_id = $4, rejection_reason = $5,
           reviewed_by = $2, reviewed_at = now(), updated_at = now() WHERE id = $1`,
        [id, req.user.id, ofReferral, ofDeal, reason]
      );
    }

    const action = { under_review: "under_review", accept: "accepted", reject: "rejected", duplicate: "marked_duplicate" }[decision];
    await logAudit({ actorId: req.user.id, action: `startup_referral.${action}`, objectType: "startup_referral", objectId: id, details: reason ? { reason } : {}, req }, client);
    if (decision !== "under_review") {
      await notifyPartner(client, current.partner_id, {
        type: "startup_review", title: `${current.startup_name}: ${decision === "accept" ? "accepted" : "not accepted"}`,
        body: decision === "accept" ? "RIV accepted this startup." : "RIV reviewed this startup. See My startups for the outcome.",
        linkView: "startups", email: true,
      });
    }
    return loadReferral(client, id);
  });
  res.json({ referral });
}));

// Open an IB deal draft from an accepted referral (PRD 6.8). The deal takes
// the startup's name and sector and the founder as the startup contact, and
// records the introducing partner as a reference. Round size, valuation,
// instrument and the rest are entered by RIV; the same deal floor applies.
router.post("/:id/create-deal", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "referral");
  const b = req.body || {};
  const terms = {
    instrument: v.oneOf(b.instrument, R.DEAL_INSTRUMENTS, "Instrument", { required: true }),
    round_size: v.number(b.round_size, "Round size", { required: true, min: 1, max: 1e12 }),
    pre_money_valuation: v.number(b.pre_money_valuation, "Pre-money valuation", { required: true, min: 1, max: 1e13 }),
  };
  const optional = {
    riv_allocation: v.number(b.riv_allocation, "RIV allocation", { min: 1, max: 1e12 }),
    fee_pct: v.number(b.fee_pct, "Fee %", { min: 0, max: 100 }),
    sweat_equity_pct: v.number(b.sweat_equity_pct, "Sweat equity %", { min: 0, max: 100 }),
    below_floor_reason: v.text(b.below_floor_reason, "Reason for going below the floor", { max: 2000 }),
  };
  const problems = D.floorProblems({ ...terms, sweat_equity_pct: optional.sweat_equity_pct ?? 0, below_floor_reason: optional.below_floor_reason });
  if (problems.length) throw httpError(400, problems.join(" "));

  await inTransaction(pool, async (client) => {
    const r = await loadReferral(client, id, { lock: true });
    if (r.status !== "Accepted") throw httpError(400, "Accept the startup before opening a deal for it.");
    if (r.deal_vehicle_id) throw httpError(400, "A deal has already been opened for this startup.");
    const { rows: veh } = await client.query(
      `INSERT INTO vehicles (type, name, legal_entity, status, target_raise, pre_money_valuation, visible_to_partners, visible_to_investors)
       VALUES ('IB Deal', $1, 'Retail X HoldCo', 'Draft', $2, $3, true, true) RETURNING id`,
      [`${r.startup_name} ${terms.instrument === "Equity" ? "round" : terms.instrument}`, optional.riv_allocation || terms.round_size, terms.pre_money_valuation]
    );
    const cols = { startup_name: r.startup_name, sector: r.sector, ...terms, startup_contact_name: r.founder_name, startup_contact_email: r.founder_email, introduced_by_partner_id: r.partner_id };
    for (const [k, val] of Object.entries(optional)) if (val !== null && val !== undefined) cols[k] = val;
    const names = Object.keys(cols);
    await client.query(
      `INSERT INTO ib_deals (vehicle_id, ${names.join(", ")}, created_by) VALUES ($1, ${names.map((_, i) => `$${i + 2}`).join(", ")}, $${names.length + 2})`,
      [veh[0].id, ...names.map((n) => cols[n]), req.user.id]
    );
    await client.query("UPDATE startup_referrals SET deal_vehicle_id = $2, updated_at = now() WHERE id = $1", [id, veh[0].id]);
    await logAudit({ actorId: req.user.id, action: "deal.created", objectType: "vehicle", objectId: veh[0].id, details: { startup: r.startup_name, round: terms.round_size, from_referral: id }, req }, client);
    await logAudit({ actorId: req.user.id, action: "startup_referral.deal_created", objectType: "startup_referral", objectId: id, details: { deal: veh[0].id }, req }, client);
  });
  res.status(201).json({ referral: await loadReferral(pool, id) });
}));

module.exports = router;
