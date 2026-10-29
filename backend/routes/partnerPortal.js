// Venture partner's own screens (PRD 6.2, 9.1). Mounted at /api/partner.
// A partner only ever sees investors they registered, and never sees
// duplicate matches, KYC documents, restricted fields or other partners.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireRole } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const { partnerForUser } = require("../lib/identity.js");
const { KYC_STATUS_SQL, readInvestor, readContact } = require("../lib/investorFields.js");
const { logAudit } = require("../lib/audit.js");

const router = Router();
router.use(requireAuth, requireRole("partner"));

// Fields a partner may see about their own investors.
const PARTNER_INVESTOR_SQL = `
  SELECT i.id, i.kind, i.legal_name, i.display_name, i.company, i.category, i.country,
         i.ticket_min, i.ticket_max, i.destinations, i.relationship_note,
         CASE WHEN i.registration_status = 'Duplicate' THEN 'Not accepted' ELSE i.registration_status END AS registration_status,
         CASE WHEN i.registration_status = 'Rejected' THEN i.rejection_reason END AS rejection_reason,
         i.credit_expires_at, i.created_at,
         CASE WHEN i.registration_status = 'Approved' THEN ${KYC_STATUS_SQL} END AS kyc_status,
         pc.name AS primary_contact_name, pc.email AS primary_contact_email
  FROM investors i
  LEFT JOIN kyc_files k ON k.investor_id = i.id AND k.is_current
  LEFT JOIN investor_contacts pc ON pc.investor_id = i.id AND pc.is_primary
  WHERE i.partner_id = $1`;

router.get("/me", asyncRoute(async (req, res) => {
  const p = await partnerForUser(req.user.id);
  res.json({
    partner: {
      id: p.id, full_name: p.full_name, company: p.company, email: p.email, regions: p.regions, sectors: p.sectors,
      tier: p.tier, payout_holdco_pct: p.payout_holdco_pct, payout_fund_pct: p.payout_fund_pct,
      payout_ib_pct: p.payout_ib_pct, credit_window_months: p.credit_window_months,
    },
  });
}));

router.get("/investors", asyncRoute(async (req, res) => {
  const p = await partnerForUser(req.user.id);
  const { rows } = await pool.query(`${PARTNER_INVESTOR_SQL} ORDER BY i.created_at DESC`, [p.id]);
  res.json({ investors: rows });
}));

// Register an investor (PRD 6.2). Goes to RIV for review; the duplicate
// check runs when RIV opens it.
router.post("/investors", asyncRoute(async (req, res) => {
  const p = await partnerForUser(req.user.id);
  const body = req.body || {};
  const inv = readInvestor(body, { partial: false, restricted: false });
  delete inv.notes;
  delete inv.riv_owner_user_id;
  const contact = readContact(body.contact || {});
  if (!contact.email) throw httpError(400, "Add the primary contact's email.");

  const id = await inTransaction(pool, async (client) => {
    const cols = Object.keys(inv);
    const { rows } = await client.query(
      `INSERT INTO investors (${cols.join(", ")}, source, partner_id, registration_status, submitted_by_user_id)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, 'Partner', $${cols.length + 1}, 'Submitted', $${cols.length + 2})
       RETURNING id`,
      [...cols.map((c) => inv[c]), p.id, req.user.id]
    );
    await client.query(
      "INSERT INTO investor_contacts (investor_id, name, email, phone, role, is_primary) VALUES ($1, $2, $3, $4, $5, true)",
      [rows[0].id, contact.name, contact.email, contact.phone, contact.role]
    );
    await logAudit({ actorId: req.user.id, action: "investor.submitted", objectType: "investor", objectId: rows[0].id, details: { name: inv.legal_name, partner: p.full_name }, req }, client);
    return rows[0].id;
  });
  const { rows } = await pool.query(`${PARTNER_INVESTOR_SQL} AND i.id = $2`, [p.id, id]);
  res.status(201).json({ investor: rows[0] });
}));

module.exports = router;
