// Venture partner: introduce startups to RIV and follow their status.
// Mounted at /api/partner/startups. A partner sees only the startups they
// introduced, with a simplified status. They never see duplicate matches,
// and a duplicate shows as "Not accepted" with no explanation.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireRole } = require("../middleware/auth.js");
const { asyncRoute, inTransaction } = require("../lib/http.js");
const { partnerForUser } = require("../lib/identity.js");
const { logAudit } = require("../lib/audit.js");
const { notifyAdmins } = require("../lib/notify.js");
const { readStartup, STARTUP_VP_STATUS_SQL } = require("../lib/referrals.js");

const router = Router();
router.use(requireAuth, requireRole("partner"));

const PARTNER_STARTUP_SQL = `
  SELECT r.id, r.startup_name, r.website, r.linkedin_url, r.description, r.problem_solved, r.founder_name, r.founder_email,
         r.startup_stage, r.sector, r.fundraising, r.personally_interacted, r.interested_in_rise_gtm, r.why_referring,
         r.created_at, r.updated_at,
         ${STARTUP_VP_STATUS_SQL} AS vp_status,
         CASE WHEN r.status = 'Rejected' THEN r.rejection_reason END AS rejection_reason,
         CASE WHEN r.status = 'Accepted' THEN r.credit_expires_at END AS credit_expires_at
  FROM startup_referrals r
  LEFT JOIN ib_deals d ON d.vehicle_id = r.deal_vehicle_id
  WHERE r.partner_id = $1`;

router.get("/", asyncRoute(async (req, res) => {
  const p = await partnerForUser(req.user.id);
  const { rows } = await pool.query(`${PARTNER_STARTUP_SQL} ORDER BY r.created_at DESC`, [p.id]);
  res.json({ startups: rows });
}));

// Introduce a startup. It goes to RIV for review; the duplicate check runs
// when RIV opens it.
router.post("/", asyncRoute(async (req, res) => {
  const p = await partnerForUser(req.user.id);
  const s = readStartup(req.body || {});
  const id = await inTransaction(pool, async (client) => {
    const cols = Object.keys(s);
    const { rows } = await client.query(
      `INSERT INTO startup_referrals (${cols.join(", ")}, partner_id, submitted_by_user_id, consent_at)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, $${cols.length + 1}, $${cols.length + 2}, now())
       RETURNING id`,
      [...cols.map((c) => s[c]), p.id, req.user.id]
    );
    await logAudit({ actorId: req.user.id, action: "startup_referral.submitted", objectType: "startup_referral", objectId: rows[0].id, details: { startup: s.startup_name, partner: p.full_name }, req }, client);
    await notifyAdmins(client, {
      type: "startup_submitted", title: `New startup to review: ${s.startup_name}`, body: `From ${p.full_name}.`, linkView: "referrals", linkId: rows[0].id,
    });
    return rows[0].id;
  });
  const { rows } = await pool.query(`${PARTNER_STARTUP_SQL} AND r.id = $2`, [p.id, id]);
  res.status(201).json({ startup: rows[0] });
}));

module.exports = router;
