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
const { notifyAdmins } = require("../lib/notify.js");
const v = require("../lib/validate.js");
const { visibleSql, isVisible } = require("../lib/visibility.js");
const E = require("../lib/commitments.js");
const { INVESTOR_VP_STATUS_SQL, readInvestorIntro } = require("../lib/referrals.js");

const router = Router();
router.use(requireAuth, requireRole("partner"));

// Fields a partner may see about their own investors.
const PARTNER_INVESTOR_SQL = `
  SELECT i.id, i.kind, i.legal_name, i.display_name, i.company, i.category, i.country,
         i.ticket_min, i.ticket_max, i.destinations, i.relationship_note,
         CASE WHEN i.registration_status = 'Duplicate' THEN 'Not accepted' ELSE i.registration_status END AS registration_status,
         CASE WHEN i.registration_status = 'Rejected' THEN i.rejection_reason END AS rejection_reason,
         i.credit_expires_at, i.created_at,
         i.linkedin_url, i.relationship_type, i.previously_invested, i.personally_interacted, i.informed_about_riv, i.intro_methods, i.expected_support,
         ${INVESTOR_VP_STATUS_SQL} AS vp_status,
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
  Object.assign(inv, readInvestorIntro(body, inv));
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
    await notifyAdmins(client, { type: "investor_submitted", title: `New investor to review: ${inv.legal_name}`, body: `From ${p.full_name}.`, linkView: "investors" });
    return rows[0].id;
  });
  const { rows } = await pool.query(`${PARTNER_INVESTOR_SQL} AND i.id = $2`, [p.id, id]);
  res.status(201).json({ investor: rows[0] });
}));

// Vehicles and deals RIV has opened to partners, with their teasers
// (PRD 9.1, LEG-10).
router.get("/opportunities", asyncRoute(async (req, res) => {
  await partnerForUser(req.user.id);
  const { rows } = await pool.query(
    `SELECT v.id, v.type, v.name, v.summary, v.target_raise, v.pre_money_valuation, v.min_ticket_individual, v.min_ticket_entity,
            coalesce((SELECT json_agg(json_build_object('id', d.id, 'filename', d.filename, 'title', d.title) ORDER BY d.uploaded_at DESC)
                      FROM documents d WHERE d.linked_type = 'vehicle' AND d.linked_id = v.id AND d.doc_type = 'Teaser' AND d.voided_at IS NULL), '[]') AS teasers
     FROM vehicles v WHERE ${visibleSql("partner")} ORDER BY v.id`
  );
  res.json({ opportunities: rows });
}));

// Commitments of the partner's own investors: stage and amounts only
// (PRD 9.1). No documents, no other investors.
router.get("/commitments", asyncRoute(async (req, res) => {
  const p = await partnerForUser(req.user.id);
  const { rows } = await pool.query(
    `SELECT c.id, c.flow, c.stage, c.status, c.indicative_amount, c.committed_amount, c.created_at, c.updated_at,
            (c.partner_id = $1) AS credited,
            coalesce(i.display_name, i.legal_name) AS investor_name, v.name AS vehicle_name, v.type AS vehicle_type,
            coalesce((SELECT sum(m.amount) FROM money_movements m
                      WHERE m.commitment_id = c.id AND m.type = 'Subscription payment' AND m.voided_at IS NULL), 0)
              + coalesce(c.funds_transferred_amount, 0) AS received_total
     FROM commitments c JOIN investors i ON i.id = c.investor_id JOIN vehicles v ON v.id = c.vehicle_id
     WHERE i.partner_id = $1 ORDER BY c.updated_at DESC`,
    [p.id]
  );
  res.json({ commitments: rows });
}));

// Propose one of the partner's approved investors for a vehicle (PRD 6.5
// step 1). RIV takes it from there.
router.post("/commitments", asyncRoute(async (req, res) => {
  const p = await partnerForUser(req.user.id);
  const b = req.body || {};
  const investorId = v.id(b.investor_id, "investor");
  const vehicleId = v.id(b.vehicle_id, "vehicle");
  const amount = v.number(b.indicative_amount, "Indicative amount", { required: true, min: 1, max: 1e12 });
  const note = v.text(b.note, "Note", { max: 2000 });
  const { rows: own } = await pool.query("SELECT 1 FROM investors WHERE id = $1 AND partner_id = $2", [investorId, p.id]);
  if (!own[0]) throw httpError(404, "Investor not found.");
  if (!(await isVisible(pool, "partner", vehicleId))) throw httpError(404, "That opportunity isn't open.");
  const id = await inTransaction(pool, (client) => E.createCommitment(client, {
    investorId, vehicleId, amount, createdVia: "Partner", actorId: req.user.id, note, req,
  }));
  const c = await E.loadCommitment(pool, id);
  res.status(201).json({ commitment: { id: c.id, stage: c.stage, status: c.status, vehicle_name: c.vehicle_name } });
}));

// The partner's own payouts (PRD 6.9, 9.1): accruing estimates, earned,
// paid. Accruing amounts are estimates that change with the commitment.
router.get("/payouts", asyncRoute(async (req, res) => {
  const p = await partnerForUser(req.user.id);
  const { rows } = await pool.query(
    `SELECT po.id, po.flow, po.status, po.basis_amount, po.pct, po.amount, po.vat_pct, po.vat_amount, po.total, po.earned_at, po.paid_at, po.payment_reference,
            veh.name AS vehicle_name, coalesce(i.display_name, i.legal_name) AS investor_name
     FROM partner_payouts po
     JOIN vehicles veh ON veh.id = po.vehicle_id
     JOIN commitments c ON c.id = po.commitment_id
     JOIN investors i ON i.id = c.investor_id
     WHERE po.partner_id = $1 AND po.status <> 'Cancelled'
     ORDER BY po.updated_at DESC`,
    [p.id]
  );
  const sum = (statuses) => rows.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + Number(r.total), 0);
  res.json({ payouts: rows, totals: { accruing: sum(["Accruing"]), earned: sum(["Earned", "Approved"]), paid: sum(["Paid"]) } });
}));

// Updates that went to this partner's investors (PRD 6.10): that one went
// out and to whom; the contents only if RIV marked it shareable.
router.get("/updates", asyncRoute(async (req, res) => {
  const p = await partnerForUser(req.user.id);
  const { rows } = await pool.query(
    `SELECT u.id, u.type, u.published_at, u.shareable_with_partners, veh.name AS vehicle_name,
            CASE WHEN u.shareable_with_partners THEN u.title END AS title,
            CASE WHEN u.shareable_with_partners THEN u.body END AS body,
            json_agg(coalesce(i.display_name, i.legal_name) ORDER BY coalesce(i.display_name, i.legal_name)) AS investors,
            CASE WHEN u.shareable_with_partners THEN coalesce((
              SELECT json_agg(json_build_object('id', d.id, 'filename', d.filename) ORDER BY d.uploaded_at)
              FROM documents d WHERE d.linked_type = 'update' AND d.linked_id = u.id AND d.voided_at IS NULL), '[]') ELSE '[]' END AS attachments
     FROM investor_updates u
     JOIN vehicles veh ON veh.id = u.vehicle_id
     JOIN update_deliveries del ON del.update_id = u.id
     JOIN investors i ON i.id = del.investor_id AND i.partner_id = $1
     WHERE u.status = 'Published'
     GROUP BY u.id, veh.name
     ORDER BY u.published_at DESC`,
    [p.id]
  );
  res.json({ updates: rows });
}));

module.exports = router;
