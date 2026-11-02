// Duplicate check for investor registrations (PRD 6.2). Matches are shown
// to RIV admin only, never to the submitting partner.
const { pool } = require("../db.js");

// Shared mailbox domains say nothing about which organisation someone
// belongs to, so they never count as a domain match.
const FREE_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "live.com",
  "icloud.com", "me.com", "aol.com", "protonmail.com", "proton.me", "rediffmail.com", "zoho.com", "gmx.com",
]);

function domainOf(email) {
  const d = String(email || "").split("@")[1];
  return d && !FREE_DOMAINS.has(d) ? d : null;
}

// Lower case with punctuation and extra spaces removed, in any script, so
// "Acme LLC." matches "Acme LLC" and Arabic names can match. NORM_SQL must do
// the same thing as norm().
function norm(s) {
  return String(s || "").toLowerCase().replace(/[\s!-\/:-@\[-`{-~]+/g, " ").trim();
}
const NORM_SQL = (col) => `btrim(regexp_replace(lower(${col}), '[[:space:][:punct:]]+', ' ', 'g'))`;

// Returns [{ id, legal_name, company, registration_status, partner_name, reasons: [...] }].
async function findDuplicates({ investorId = null, legalName, company, emails = [] }, db = pool) {
  const names = [norm(legalName), norm(company)].filter(Boolean);
  const cleanEmails = emails.filter(Boolean).map((e) => e.toLowerCase());
  const domains = [...new Set(cleanEmails.map(domainOf).filter(Boolean))];

  const { rows } = await db.query(
    `SELECT i.id, i.legal_name, i.company, i.registration_status, p.full_name AS partner_name,
            array_remove(array_agg(DISTINCT c.email), NULL) AS emails
     FROM investors i
     LEFT JOIN investor_contacts c ON c.investor_id = i.id
     LEFT JOIN venture_partners p ON p.id = i.partner_id
     WHERE ($1::int IS NULL OR i.id <> $1)
       AND i.registration_status <> 'Duplicate'
       AND (
         ${NORM_SQL("i.legal_name")} = ANY($2)
         OR ${NORM_SQL("coalesce(i.company, '')")} = ANY($2)
         OR c.email = ANY($3)
         OR split_part(c.email, '@', 2) = ANY($4)
       )
     GROUP BY i.id, p.full_name
     ORDER BY i.id
     LIMIT 20`,
    [investorId, names.map((n) => n.trim()), cleanEmails, domains]
  );

  return rows.map((r) => {
    const reasons = [];
    if (names.includes(norm(r.legal_name)) || (r.company && names.includes(norm(r.company)))) reasons.push("Same name or company");
    if (r.emails.some((e) => cleanEmails.includes(e))) reasons.push("Same contact email");
    else if (r.emails.some((e) => domains.includes(domainOf(e)))) reasons.push("Same email domain");
    return { id: r.id, legal_name: r.legal_name, company: r.company, registration_status: r.registration_status, partner_name: r.partner_name, reasons };
  });
}

module.exports = { findDuplicates, domainOf, norm };
