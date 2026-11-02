// Venture partner onboarding, done entirely in RICap (PRD 6.1, VP-5).
// Mounted at /api/admin/partners; admin only.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const C = require("../lib/constants.js");
const { logAudit } = require("../lib/audit.js");
const { provisionLogin, sendInviteEmail } = require("../lib/provision.js");

const router = Router();
router.use(requireAuth, requireAdmin);

const LIST_SQL = `
  SELECT p.*, u.status AS login_status, u.last_login_at,
         o.name AS riv_owner_name,
         (SELECT count(*)::int FROM investors i WHERE i.partner_id = p.id) AS investor_count,
         (SELECT count(*)::int FROM investors i WHERE i.partner_id = p.id AND i.registration_status = 'Approved') AS approved_investor_count
  FROM venture_partners p
  LEFT JOIN users u ON u.id = p.user_id
  LEFT JOIN users o ON o.id = p.riv_owner_user_id`;

// Reads editable partner fields from a request body. Only keys present are
// read, so a new partner gets the table defaults (stage New, 4% / 4% / 15%
// payouts, 12-month credit window) for anything left out. Name and email
// are always required on create.
const REQUIRED_ON_CREATE = ["full_name", "email"];
function readPartner(body, { partial }) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k) || (!partial && REQUIRED_ON_CREATE.includes(k));
  if (has("full_name")) out.full_name = v.text(body.full_name, "Full name", { required: true, max: 200 });
  if (has("email")) out.email = v.email(body.email, "Email", { required: true });
  if (has("company")) out.company = v.text(body.company, "Company", { max: 200 });
  if (has("phone")) out.phone = v.text(body.phone, "Phone", { max: 50 });
  if (has("linkedin_url")) out.linkedin_url = v.text(body.linkedin_url, "LinkedIn URL", { max: 500 });
  if (has("regions")) out.regions = v.textList(body.regions, "Regions");
  if (has("sectors")) out.sectors = v.textList(body.sectors, "Sectors");
  if (has("tier")) out.tier = v.oneOf(body.tier, C.PARTNER_TIERS, "Tier");
  if (has("investor_reach_count")) out.investor_reach_count = v.number(body.investor_reach_count, "Investor reach", { min: 0, max: 100000, integer: true });
  if (has("investor_network_types")) out.investor_network_types = v.manyOf(body.investor_network_types, C.PARTNER_NETWORK_TYPES, "Investor network types");
  if (has("retail_network")) out.retail_network = v.text(body.retail_network, "Retail network", { max: 4000 });
  if (has("profile_summary")) out.profile_summary = v.text(body.profile_summary, "Profile summary", { max: 4000 });
  if (has("onboarding_stage")) out.onboarding_stage = v.oneOf(body.onboarding_stage, C.PARTNER_STAGES, "Onboarding stage", { required: true });
  if (has("agreement_link")) out.agreement_link = v.text(body.agreement_link, "Agreement link", { max: 1000 });
  if (has("agreement_signed_date")) out.agreement_signed_date = v.date(body.agreement_signed_date, "Agreement signed date");
  if (has("payout_holdco_pct")) out.payout_holdco_pct = v.number(body.payout_holdco_pct, "HoldCo payout %", { required: true, min: 0, max: 100 });
  if (has("payout_fund_pct")) out.payout_fund_pct = v.number(body.payout_fund_pct, "Fund payout %", { required: true, min: 0, max: 100 });
  if (has("payout_ib_pct")) out.payout_ib_pct = v.number(body.payout_ib_pct, "IB payout %", { required: true, min: 0, max: 100 });
  if (has("payout_vat_pct")) out.payout_vat_pct = v.number(body.payout_vat_pct, "VAT on payouts %", { required: true, min: 0, max: 100 });
  if (has("credit_window_months")) out.credit_window_months = v.number(body.credit_window_months, "Credit window", { required: true, min: 0, max: 120, integer: true });
  if (has("riv_owner_user_id")) out.riv_owner_user_id = body.riv_owner_user_id ? v.id(body.riv_owner_user_id, "RIV owner") : null;
  if (has("status")) out.status = v.oneOf(body.status, ["Active", "Inactive"], "Status", { required: true });
  if (has("notes")) out.notes = v.text(body.notes, "Notes", { max: 4000 });
  return out;
}

// A partner can only be marked Signed or Onboarded once the agreement is
// signed (PRD 6.1).
function checkStage(merged) {
  if (["Signed", "Onboarded"].includes(merged.onboarding_stage) && !merged.agreement_signed_date) {
    throw httpError(400, "Enter the agreement signed date before marking the partner Signed or Onboarded.");
  }
}

router.get("/", asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`${LIST_SQL} ORDER BY p.created_at DESC`);
  res.json({ partners: rows });
}));

router.get("/:id", asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`${LIST_SQL} WHERE p.id = $1`, [v.id(req.params.id)]);
  if (!rows[0]) throw httpError(404, "Partner not found.");
  const { rows: investors } = await pool.query(
    `SELECT id, legal_name, company, category, registration_status, credit_expires_at, created_at
     FROM investors WHERE partner_id = $1 ORDER BY created_at DESC`,
    [rows[0].id]
  );
  res.json({ partner: rows[0], investors });
}));

router.post("/", asyncRoute(async (req, res) => {
  const p = readPartner(req.body || {}, { partial: false });
  checkStage(p);
  const partner = await inTransaction(pool, async (client) => {
    const dup = await client.query("SELECT id FROM venture_partners WHERE email = $1", [p.email]);
    if (dup.rows[0]) throw httpError(409, "A partner with this email already exists.");
    const cols = Object.keys(p);
    const { rows } = await client.query(
      `INSERT INTO venture_partners (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      cols.map((c) => p[c])
    );
    await logAudit({ actorId: req.user.id, action: "partner.created", objectType: "partner", objectId: rows[0].id, details: { name: p.full_name }, req }, client);
    return rows[0];
  });
  res.status(201).json({ partner });
}));

router.patch("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const changes = readPartner(req.body || {}, { partial: true });
  const partner = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM venture_partners WHERE id = $1 FOR UPDATE", [id]);
    const current = rows[0];
    if (!current) throw httpError(404, "Partner not found.");
    checkStage({ ...current, ...changes });
    if (changes.email && changes.email !== current.email && current.user_id) {
      throw httpError(400, "This partner already has a login, so their email can't be changed here.");
    }
    const cols = Object.keys(changes);
    if (!cols.length) return current;
    const { rows: updated } = await client.query(
      `UPDATE venture_partners SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, ...cols.map((c) => changes[c])]
    );
    const changed = cols.filter((c) => String(current[c]) !== String(updated[0][c]));
    await logAudit({ actorId: req.user.id, action: "partner.updated", objectType: "partner", objectId: id, details: { fields: changed.join(", ") }, req }, client);
    return updated[0];
  });
  res.json({ partner });
}));

// Sends (or re-sends) the partner's RICap login invite. Only once the
// partner is Onboarded, i.e. the agreement is signed (PRD 6.1).
router.post("/:id/invite", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const { partner, link } = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM venture_partners WHERE id = $1 FOR UPDATE", [id]);
    const p = rows[0];
    if (!p) throw httpError(404, "Partner not found.");
    if (p.onboarding_stage !== "Onboarded") throw httpError(400, "Mark the partner Onboarded (agreement signed) before inviting them.");
    if (p.status !== "Active") throw httpError(400, "This partner is inactive.");
    const { userId, link } = await provisionLogin(client, {
      existingUserId: p.user_id, email: p.email, name: p.full_name, role: "partner", company: p.company, invitedBy: req.user.id,
    });
    if (!p.user_id) await client.query("UPDATE venture_partners SET user_id = $2, updated_at = now() WHERE id = $1", [id, userId]);
    await logAudit({ actorId: req.user.id, action: p.user_id ? "partner.invite_resent" : "partner.invited", objectType: "partner", objectId: id, req }, client);
    return { partner: p, link };
  });
  res.json(await sendInviteEmail({ email: partner.email, name: partner.full_name, role: "partner", link }));
}));

module.exports = router;
