// Venture partner referrals (investor introductions and startup
// introductions): picklists, input readers, the VP-facing status shown to a
// partner, and the startup duplicate check. Picklists must match the CHECK
// constraints in migrations/009_vp_referrals.sql.
const { pool } = require("../db.js");
const v = require("./validate.js");
const { httpError } = require("./http.js");
const { norm } = require("./duplicates.js");
const { COUNTRIES } = require("./countries.js");

const YES_NO = ["Yes", "No"];
const RELATIONSHIP_TYPES = ["Friend", "Colleague", "Mentor", "Co-investor", "Professional Network", "Other"];
const INTRO_METHODS = ["Email", "WhatsApp", "LinkedIn", "In person"];
const EXPECTED_SUPPORT = ["Initial introduction", "Follow-up facilitation", "Available as needed"];

const STARTUP_STAGES = ["Idea", "Pre-revenue", "Early Revenue", "Scaling"];
const STARTUP_SECTORS = ["Retail Tech", "Consumer Tech", "Agri Tech", "Health Tech", "Fin Tech", "Supply Chain & Logistics", "Other"];
const FUNDRAISING = ["Yes", "No", "Exploring"];
const REFERRAL_STATUSES = ["Submitted", "Under review", "Accepted", "Rejected", "Duplicate"];
const DEAL_INSTRUMENTS = ["Equity", "SAFE", "Convertible", "Other"];

// What the partner sees for an investor they introduced. The furthest-along
// state wins when an investor has several commitments. Admin screens keep
// the detailed registration, KYC and commitment stages.
//   Invested:    money received (HoldCo) or transferred to the startup (IB).
//   In progress: a live commitment exists (Fund soft commitments too, in v1).
const INVESTOR_VP_STATUS_SQL = `
  CASE
    WHEN i.registration_status = 'Submitted' THEN 'Submitted'
    WHEN i.registration_status IN ('Rejected', 'Duplicate') THEN 'Not accepted'
    WHEN EXISTS (SELECT 1 FROM commitments c
                 WHERE c.investor_id = i.id AND c.status IN ('Active', 'On hold')
                   AND ((c.flow = 'HoldCo' AND c.stage IN ('Funds received', 'Shares issued', 'Active shareholder'))
                     OR (c.flow = 'IB' AND c.stage IN ('Funds transferred', 'Closed')))) THEN 'Invested'
    WHEN EXISTS (SELECT 1 FROM commitments c WHERE c.investor_id = i.id AND c.status IN ('Active', 'On hold')) THEN 'In progress'
    ELSE 'Accepted'
  END`;

// What the partner sees for a startup they introduced. Needs ib_deals joined
// as d on r.deal_vehicle_id. Once a deal exists the status follows the deal.
const STARTUP_VP_STATUS_SQL = `
  CASE
    WHEN r.status IN ('Rejected', 'Duplicate') THEN 'Not accepted'
    WHEN r.status = 'Accepted' AND d.deal_status = 'Live' THEN 'Live'
    WHEN r.status = 'Accepted' AND d.deal_status IN ('Closed', 'Withdrawn') THEN 'Closed'
    ELSE r.status
  END`;

// Same normalisation as lib/duplicates.js (NORM_SQL there is not exported).
const NORM_SQL = (col) => `btrim(regexp_replace(lower(${col}), '[[:space:][:punct:]]+', ' ', 'g'))`;

// A web address people actually type: "acme.com" is accepted and stored as
// https://acme.com. Returns { href, domain }.
function webAddress(value, label, { required = false } = {}) {
  const raw = v.text(value, label, { required, max: 255 });
  if (raw === null) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw httpError(400, `${label} isn't a valid web address.`);
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) throw httpError(400, `${label} isn't a valid web address.`);
  const plain = url.pathname === "/" && !url.search && !url.hash;
  return { href: plain ? `${url.protocol}//${url.host}` : url.href, domain: url.hostname.toLowerCase().replace(/^www\./, "") };
}

function requireConsent(body, message) {
  if (!v.bool(body.data_consent)) throw httpError(400, message);
}

// Extra answers on a partner's investor introduction (PRD: Investor
// introduction). Returns columns for the investors row. The caller has
// already read the base fields with readInvestor().
function readInvestorIntro(body, base) {
  requireConsent(body, "Confirm that the investor agreed to be introduced to RIV.");
  if (base.ticket_min == null && base.ticket_max == null) throw httpError(400, "Enter the indicative investment size (at least one figure).");
  if (!base.relationship_note) throw httpError(400, "Say why you are referring this investor.");
  if (base.relationship_note.length > 2000) throw httpError(400, "Why you are referring this investor is too long (max 2000 characters).");
  const country = v.text(body.country, "Country", { max: 100 });
  if (country && !COUNTRIES.includes(country)) throw httpError(400, "Pick the country from the list.");
  const linkedin = webAddress(body.linkedin_url, "LinkedIn URL");
  return {
    linkedin_url: linkedin ? linkedin.href : null,
    relationship_type: v.oneOf(body.relationship_type, RELATIONSHIP_TYPES, "Source", { required: true }),
    previously_invested: v.oneOf(body.previously_invested, YES_NO, "Previously invested in startups"),
    personally_interacted: v.oneOf(body.personally_interacted, YES_NO, "Personally interacted with the investor"),
    informed_about_riv: v.oneOf(body.informed_about_riv, YES_NO, "Investor informed about RIV"),
    intro_methods: v.manyOf(body.intro_methods, INTRO_METHODS, "How you introduced the investor"),
    expected_support: v.oneOf(body.expected_support, EXPECTED_SUPPORT, "Expected support"),
  };
}

// A partner's startup introduction.
function readStartup(body) {
  requireConsent(body, "Confirm that the founder agreed to be introduced to RIV.");
  const site = webAddress(body.website, "Website", { required: true });
  const linkedin = webAddress(body.linkedin_url, "LinkedIn URL");
  return {
    startup_name: v.text(body.startup_name, "Startup name", { required: true, max: 120 }),
    website: site.href,
    website_domain: site.domain,
    linkedin_url: linkedin ? linkedin.href : null,
    description: v.text(body.description, "Startup description", { required: true, max: 2000 }),
    problem_solved: v.text(body.problem_solved, "Problem being solved", { max: 2000 }),
    founder_name: v.text(body.founder_name, "Founder name", { required: true, max: 255 }),
    founder_email: v.email(body.founder_email, "Founder email", { required: true }),
    startup_stage: v.oneOf(body.startup_stage, STARTUP_STAGES, "Startup stage"),
    sector: v.oneOf(body.sector, STARTUP_SECTORS, "Sector"),
    fundraising: v.oneOf(body.fundraising, FUNDRAISING, "Currently fundraising"),
    personally_interacted: v.oneOf(body.personally_interacted, YES_NO, "Personally interacted with the founder"),
    interested_in_rise_gtm: v.oneOf(body.interested_in_rise_gtm, YES_NO, "Interested in RISE GTM support"),
    why_referring: v.text(body.why_referring, "Why you are referring this startup", { required: true, max: 2000 }),
  };
}

// Possible duplicates of a startup referral: other referrals and IB deals
// with the same website domain, name or founder / contact email. Shown to
// RIV admin only, never to the submitting partner. An accepted referral
// whose credit is still running is flagged, so RIV can settle who gets it.
async function findStartupDuplicates({ referralId = null, name, domain, founderEmail }, db = pool) {
  const normName = norm(name);
  const email = String(founderEmail || "").toLowerCase();
  const { rows: refs } = await db.query(
    `SELECT r.id, r.startup_name, r.status, r.website_domain, r.founder_email, r.credit_expires_at, p.full_name AS partner_name
     FROM startup_referrals r JOIN venture_partners p ON p.id = r.partner_id
     WHERE ($1::int IS NULL OR r.id <> $1) AND r.status <> 'Duplicate'
       AND (r.website_domain = $2 OR ${NORM_SQL("r.startup_name")} = $3 OR r.founder_email = $4)
     ORDER BY r.id LIMIT 20`,
    [referralId, domain, normName, email]
  );
  const { rows: deals } = await db.query(
    `SELECT d.vehicle_id AS id, d.startup_name, d.deal_status, d.startup_contact_email, p.full_name AS partner_name
     FROM ib_deals d LEFT JOIN venture_partners p ON p.id = d.introduced_by_partner_id
     WHERE (${NORM_SQL("d.startup_name")} = $1 OR d.startup_contact_email = $2)
       AND d.vehicle_id IS DISTINCT FROM (SELECT deal_vehicle_id FROM startup_referrals WHERE id = $3)
     ORDER BY d.vehicle_id LIMIT 20`,
    [normName, email, referralId]
  );
  const now = new Date();
  return [
    ...refs.map((r) => {
      const reasons = [];
      if (r.website_domain === domain) reasons.push("Same website");
      if (norm(r.startup_name) === normName) reasons.push("Same name");
      if (r.founder_email === email) reasons.push("Same founder email");
      const protectedUntil = r.status === "Accepted" && r.credit_expires_at && new Date(r.credit_expires_at) > now ? r.credit_expires_at : null;
      if (protectedUntil) reasons.push(`Credit protected until ${new Date(protectedUntil).toISOString().slice(0, 10)}`);
      return { type: "referral", id: r.id, name: r.startup_name, status: r.status, partner_name: r.partner_name, reasons };
    }),
    ...deals.map((d) => {
      const reasons = [];
      if (norm(d.startup_name) === normName) reasons.push("Same name");
      if (d.startup_contact_email && d.startup_contact_email === email) reasons.push("Same contact email");
      return { type: "deal", id: d.id, name: d.startup_name, status: `Deal: ${d.deal_status}`, partner_name: d.partner_name, reasons };
    }),
  ];
}

module.exports = {
  YES_NO, RELATIONSHIP_TYPES, INTRO_METHODS, EXPECTED_SUPPORT, STARTUP_STAGES, STARTUP_SECTORS, FUNDRAISING, REFERRAL_STATUSES, DEAL_INSTRUMENTS,
  INVESTOR_VP_STATUS_SQL, STARTUP_VP_STATUS_SQL, NORM_SQL, webAddress, readInvestorIntro, readStartup, findStartupDuplicates,
};
