// One-time Bigin import (PRD 10, INV-2, VP-5): RIV's existing investor
// pipeline and the list of prospective venture partners. Upload a CSV
// export, preview what will happen to each row, then import.
// Mounted at /api/admin/import; admin only.
const express = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const { parseCsv } = require("../lib/csv.js");
const { logAudit } = require("../lib/audit.js");
const { norm } = require("../lib/duplicates.js");

const router = express.Router();
router.use(requireAuth, requireAdmin, express.json({ limit: "5mb" }));

const MAX_ROWS = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bigin column names vary by module and export settings, so each field
// accepts several header names (compared case-insensitively). When the real
// export arrives, add its headers here if they aren't covered.
const ALIASES = {
  bigin_id: ["record id", "id", "contact id", "bigin id"],
  first_name: ["first name"],
  last_name: ["last name"],
  name: ["full name", "name", "contact name", "investor name", "partner name"],
  company: ["account name", "company", "company name", "organization", "organisation"],
  email: ["email", "email address", "primary email"],
  phone: ["mobile", "phone", "mobile number", "phone number"],
  country: ["country", "mailing country", "billing country"],
  category: ["investor type", "category", "type", "investor category"],
  ticket: ["ticket size", "ticket", "amount", "investment amount"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile"],
  region: ["region", "regions"],
  notes: ["description", "notes", "stage", "pipeline stage"],
};

function pick(row, field) {
  const keys = Object.keys(row);
  for (const alias of ALIASES[field]) {
    const k = keys.find((h) => h.toLowerCase() === alias);
    if (k && row[k]) return row[k];
  }
  return "";
}

function personName(row) {
  return pick(row, "name") || [pick(row, "first_name"), pick(row, "last_name")].filter(Boolean).join(" ");
}

// Free-text Bigin categories mapped onto RICap's list (PRD 8.2).
function mapCategory(raw, hasCompany) {
  const s = raw.toLowerCase();
  if (s.includes("family")) return "Family office";
  if (s.includes("corporate vc") || s.includes("cvc")) return "Corporate VC";
  if (s.includes("angel") || s.includes("syndicate")) return "Angel / syndicate";
  if (/\bvc\b|venture/.test(s)) return "VC fund";
  if (s.includes("pension")) return "Pension fund";
  if (s.includes("endowment")) return "Endowment";
  if (s.includes("sovereign") || s.includes("government") || s.includes("govt")) return "Government / sovereign fund";
  if (s.includes("retail") || s.includes("corporate") || s.includes("corp dev")) return "Retail house / corporate development";
  if (s.includes("consumer")) return "Retail / consumer fund";
  if (s.includes("hnw") || s.includes("individual") || s.includes("hni")) return "HNW individual";
  return hasCompany ? "Other" : "HNW individual";
}

function parseTicket(raw) {
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return raw && Number.isFinite(n) && n > 0 ? n : null;
}

// Works out what would happen to each row, without writing anything.
async function planInvestors(rows, db) {
  const { rows: existing } = await db.query(
    `SELECT i.bigin_id, lower(i.legal_name) AS name, lower(c.email) AS email
     FROM investors i LEFT JOIN investor_contacts c ON c.investor_id = i.id`
  );
  const ids = new Set(existing.map((e) => e.bigin_id).filter(Boolean));
  const names = new Set(existing.map((e) => norm(e.name)));
  const emails = new Set(existing.map((e) => e.email).filter(Boolean));

  return rows.map((row, i) => {
    const line = i + 2; // header is line 1
    const person = personName(row);
    const company = pick(row, "company");
    const email = pick(row, "email").toLowerCase();
    const biginId = pick(row, "bigin_id") || null;
    const category = mapCategory(pick(row, "category"), Boolean(company));
    const kind = category === "HNW individual" || !company ? "Individual" : "Entity";
    const legalName = kind === "Entity" ? company : person;
    const plan = {
      line, action: "create", issue: null,
      investor: { kind, legal_name: legalName, company: company || null, category, country: pick(row, "country") || null, ticket_max: parseTicket(pick(row, "ticket")), bigin_id: biginId, notes: pick(row, "notes") || null },
      contact: { name: person || legalName, email: email || null, phone: pick(row, "phone") || null },
    };
    if (!legalName) return { ...plan, action: "error", issue: "No name or company" };
    if (email && !EMAIL_RE.test(email)) return { ...plan, action: "error", issue: `Invalid email "${email}"` };
    if (biginId && ids.has(biginId)) return { ...plan, action: "skip", issue: "Already imported (same Bigin record id)" };
    if (email && emails.has(email)) return { ...plan, action: "skip", issue: "An investor contact with this email already exists" };
    if (names.has(norm(legalName))) return { ...plan, action: "skip", issue: "An investor with this name already exists" };
    if (biginId) ids.add(biginId);
    if (email) emails.add(email);
    names.add(norm(legalName));
    return plan;
  });
}

async function planPartners(rows, db) {
  const { rows: existing } = await db.query("SELECT email, bigin_id FROM venture_partners");
  const emails = new Set(existing.map((e) => e.email));
  const ids = new Set(existing.map((e) => e.bigin_id).filter(Boolean));

  return rows.map((row, i) => {
    const line = i + 2;
    const email = pick(row, "email").toLowerCase();
    const biginId = pick(row, "bigin_id") || null;
    const region = pick(row, "region") || pick(row, "country");
    const plan = {
      line, action: "create", issue: null,
      partner: { full_name: personName(row), email, company: pick(row, "company") || null, phone: pick(row, "phone") || null, linkedin_url: pick(row, "linkedin") || null, regions: region ? [region] : [], bigin_id: biginId, notes: pick(row, "notes") || null },
    };
    if (!plan.partner.full_name) return { ...plan, action: "error", issue: "No name" };
    if (!email || !EMAIL_RE.test(email)) return { ...plan, action: "error", issue: email ? `Invalid email "${email}"` : "No email (partners need one to log in later)" };
    if (biginId && ids.has(biginId)) return { ...plan, action: "skip", issue: "Already imported (same Bigin record id)" };
    if (emails.has(email)) return { ...plan, action: "skip", issue: "A partner with this email already exists" };
    emails.add(email);
    if (biginId) ids.add(biginId);
    return plan;
  });
}

function readUpload(body) {
  const kind = v.oneOf(body?.kind, ["investors", "partners"], "Import type", { required: true });
  const { headers, rows } = parseCsv(body?.csv);
  if (!headers.length) throw httpError(400, "The file is empty or isn't a CSV.");
  if (rows.length > MAX_ROWS) throw httpError(400, `Too many rows (${rows.length}). Split the file into parts of ${MAX_ROWS} or fewer.`);
  return { kind, headers, rows, filename: v.text(body?.filename, "File name", { max: 300 }) };
}

function summarize(plan) {
  return {
    total: plan.length,
    create: plan.filter((p) => p.action === "create").length,
    skip: plan.filter((p) => p.action === "skip").length,
    error: plan.filter((p) => p.action === "error").length,
  };
}

router.post("/preview", asyncRoute(async (req, res) => {
  const { kind, headers, rows } = readUpload(req.body);
  const plan = kind === "investors" ? await planInvestors(rows, pool) : await planPartners(rows, pool);
  const recognised = Object.fromEntries(Object.keys(ALIASES).map((f) => [f, headers.find((h) => ALIASES[f].includes(h.toLowerCase())) || null]));
  res.json({ kind, headers, recognised, summary: summarize(plan), rows: plan });
}));

// Imported investors are RIV's own pipeline: approved, no partner credit.
// Imported partners start at onboarding stage New.
router.post("/run", asyncRoute(async (req, res) => {
  const { kind, rows, filename } = readUpload(req.body);
  const result = await inTransaction(pool, async (client) => {
    const plan = kind === "investors" ? await planInvestors(rows, client) : await planPartners(rows, client);
    for (const p of plan.filter((x) => x.action === "create")) {
      if (kind === "investors") {
        const inv = p.investor;
        const { rows: created } = await client.query(
          `INSERT INTO investors (kind, legal_name, company, category, country, ticket_max, bigin_id, notes,
             source, registration_status, reviewed_by, reviewed_at, submitted_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Bigin import', 'Approved', $9, now(), $9) RETURNING id`,
          [inv.kind, inv.legal_name, inv.company, inv.category, inv.country, inv.ticket_max, inv.bigin_id, inv.notes, req.user.id]
        );
        await client.query(
          "INSERT INTO investor_contacts (investor_id, name, email, phone, is_primary) VALUES ($1, $2, $3, $4, true)",
          [created[0].id, p.contact.name, p.contact.email, p.contact.phone]
        );
      } else {
        const pt = p.partner;
        await client.query(
          `INSERT INTO venture_partners (full_name, email, company, phone, linkedin_url, regions, bigin_id, notes, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Bigin import')`,
          [pt.full_name, pt.email, pt.company, pt.phone, pt.linkedin_url, pt.regions, pt.bigin_id, pt.notes]
        );
      }
    }
    const summary = summarize(plan);
    const issues = plan.filter((x) => x.action !== "create").map((x) => ({ line: x.line, action: x.action, issue: x.issue }));
    const { rows: rec } = await client.query(
      `INSERT INTO bigin_imports (kind, filename, row_count, created_count, skipped_count, issues, imported_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [kind, filename, summary.total, summary.create, summary.skip + summary.error, JSON.stringify(issues), req.user.id]
    );
    await logAudit({ actorId: req.user.id, action: "bigin.imported", objectType: "bigin_import", objectId: rec[0].id, details: { kind, created: summary.create, skipped: summary.skip + summary.error }, req }, client);
    return summary;
  });
  res.json({ summary: result });
}));

router.get("/history", asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id, b.kind, b.filename, b.row_count, b.created_count, b.skipped_count, b.created_at, u.name AS imported_by_name
     FROM bigin_imports b LEFT JOIN users u ON u.id = b.imported_by ORDER BY b.created_at DESC LIMIT 50`
  );
  res.json({ imports: rows });
}));

module.exports = router;
