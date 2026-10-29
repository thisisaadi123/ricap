// Investor registration review, RIV-direct investors and contacts
// (PRD 6.2, 6.3, 6.14 access). Mounted at /api/admin/investors; admin only.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const C = require("../lib/constants.js");
const { logAudit } = require("../lib/audit.js");
const { findDuplicates } = require("../lib/duplicates.js");
const { hasRestrictedAccess } = require("../lib/identity.js");
const { KYC_STATUS_SQL, readInvestor, readContact, stripRestricted } = require("../lib/investorFields.js");
const { provisionLogin, sendInviteEmail } = require("../lib/provision.js");

const router = Router();
router.use(requireAuth, requireAdmin);

const LIST_SQL = `
  SELECT i.*, p.full_name AS partner_name, ${KYC_STATUS_SQL} AS kyc_status,
         pc.name AS primary_contact_name, pc.email AS primary_contact_email
  FROM investors i
  LEFT JOIN venture_partners p ON p.id = i.partner_id
  LEFT JOIN kyc_files k ON k.investor_id = i.id AND k.is_current
  LEFT JOIN investor_contacts pc ON pc.investor_id = i.id AND pc.is_primary`;

async function loadContacts(investorId, db = pool) {
  const { rows } = await db.query(
    `SELECT c.*, u.status AS login_status, u.last_login_at
     FROM investor_contacts c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.investor_id = $1 ORDER BY c.is_primary DESC, c.created_at`,
    [investorId]
  );
  return rows;
}

router.get("/", asyncRoute(async (req, res) => {
  const restricted = await hasRestrictedAccess(req.user.id);
  const where = [];
  const params = [];
  if (req.query.status) { params.push(v.oneOf(req.query.status, C.REGISTRATION_STATUSES, "Status")); where.push(`i.registration_status = $${params.length}`); }
  if (req.query.partner_id) { params.push(v.id(req.query.partner_id, "partner")); where.push(`i.partner_id = $${params.length}`); }
  if (req.query.q) {
    params.push(`%${String(req.query.q).toLowerCase().slice(0, 100)}%`);
    where.push(`(lower(i.legal_name) LIKE $${params.length} OR lower(coalesce(i.company, '')) LIKE $${params.length} OR lower(coalesce(pc.email, '')) LIKE $${params.length})`);
  }
  const { rows } = await pool.query(`${LIST_SQL} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY i.created_at DESC LIMIT 500`, params);
  res.json({ investors: rows.map((r) => stripRestricted(r, restricted)), restricted });
}));

router.get("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const restricted = await hasRestrictedAccess(req.user.id);
  const { rows } = await pool.query(`${LIST_SQL} WHERE i.id = $1`, [id]);
  const investor = rows[0];
  if (!investor) throw httpError(404, "Investor not found.");
  const contacts = await loadContacts(id);
  const duplicates = await findDuplicates({ investorId: id, legalName: investor.legal_name, company: investor.company, emails: contacts.map((c) => c.email) });
  const { rows: documents } = await pool.query(
    `SELECT d.id, d.doc_type, d.title, d.filename, d.size_bytes, d.confidentiality, d.signature_status, d.source,
            d.version, d.uploaded_at, d.voided_at, d.void_reason, u.name AS uploaded_by_name
     FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.linked_type = 'investor' AND d.linked_id = $1 AND ($2 OR d.confidentiality <> 'Restricted')
     ORDER BY d.uploaded_at DESC`,
    [id, restricted]
  );
  res.json({ investor: stripRestricted(investor, restricted), contacts, duplicates, documents, restricted });
}));

// RIV-direct investor (PRD 6.3): approved straight away, but the duplicate
// check still runs. A possible duplicate needs explicit confirmation.
router.post("/", asyncRoute(async (req, res) => {
  const body = req.body || {};
  const restricted = await hasRestrictedAccess(req.user.id);
  const inv = readInvestor(body, { partial: false, restricted });
  const source = v.oneOf(body.source || "RIV direct", C.ADMIN_INVESTOR_SOURCES, "Source", { required: true });
  const contact = readContact(body.contact || {});

  const duplicates = await findDuplicates({ legalName: inv.legal_name, company: inv.company, emails: [contact.email] });
  if (duplicates.length && !v.bool(body.confirm_not_duplicate)) {
    return res.status(409).json({ error: "This looks like an investor RICap already has. Check the matches, then confirm to add anyway.", duplicates });
  }

  const investor = await inTransaction(pool, async (client) => {
    const cols = Object.keys(inv);
    const values = cols.map((c) => inv[c]);
    const { rows } = await client.query(
      `INSERT INTO investors (${cols.join(", ")}, source, registration_status, reviewed_by, reviewed_at, submitted_by_user_id)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, $${cols.length + 1}, 'Approved', $${cols.length + 2}, now(), $${cols.length + 2})
       RETURNING *`,
      [...values, source, req.user.id]
    );
    await client.query(
      "INSERT INTO investor_contacts (investor_id, name, email, phone, role, is_primary) VALUES ($1, $2, $3, $4, $5, true)",
      [rows[0].id, contact.name, contact.email, contact.phone, contact.role]
    );
    await logAudit({ actorId: req.user.id, action: "investor.created", objectType: "investor", objectId: rows[0].id, details: { name: inv.legal_name, source }, req }, client);
    return rows[0];
  });
  res.status(201).json({ investor: stripRestricted(investor, restricted) });
}));

router.patch("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const restricted = await hasRestrictedAccess(req.user.id);
  const changes = readInvestor(req.body || {}, { partial: true, restricted });
  const investor = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM investors WHERE id = $1 FOR UPDATE", [id]);
    const current = rows[0];
    if (!current) throw httpError(404, "Investor not found.");
    // Keep the original consent date when consent is re-confirmed.
    if (changes.data_consent_at && current.data_consent_at) delete changes.data_consent_at;
    const merged = { ...current, ...changes };
    if (merged.ticket_min != null && merged.ticket_max != null && Number(merged.ticket_min) > Number(merged.ticket_max)) {
      throw httpError(400, "Minimum ticket can't be more than the maximum.");
    }
    const cols = Object.keys(changes);
    if (!cols.length) return current;
    const { rows: updated } = await client.query(
      `UPDATE investors SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...cols.map((c) => changes[c])]
    );
    await logAudit({ actorId: req.user.id, action: "investor.updated", objectType: "investor", objectId: id, details: { fields: cols.join(", ") }, req }, client);
    return updated[0];
  });
  res.json({ investor: stripRestricted(investor, restricted) });
}));

// Approve, reject or mark a partner's submission as a duplicate (PRD 6.2).
// Approval locks credit to the submitting partner for their window (VP-3).
router.post("/:id/review", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const decision = v.oneOf(req.body?.decision, ["approve", "reject", "duplicate"], "Decision", { required: true });
  const reason = v.text(req.body?.reason, "Reason", { max: 2000 });
  const investor = await inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT i.*, p.credit_window_months FROM investors i LEFT JOIN venture_partners p ON p.id = i.partner_id
       WHERE i.id = $1 FOR UPDATE OF i`,
      [id]
    );
    const current = rows[0];
    if (!current) throw httpError(404, "Investor not found.");
    if (current.registration_status !== "Submitted") throw httpError(400, `This investor is already ${current.registration_status.toLowerCase()}.`);

    let result;
    if (decision === "approve") {
      ({ rows: [result] } = await client.query(
        `UPDATE investors SET registration_status = 'Approved', reviewed_by = $2, reviewed_at = now(),
           credit_expires_at = CASE WHEN partner_id IS NULL THEN NULL ELSE now() + make_interval(months => $3) END,
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, req.user.id, current.credit_window_months ?? 12]
      ));
    } else if (decision === "reject") {
      if (!reason) throw httpError(400, "Give a reason for rejecting.");
      ({ rows: [result] } = await client.query(
        `UPDATE investors SET registration_status = 'Rejected', rejection_reason = $3, reviewed_by = $2, reviewed_at = now(), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, req.user.id, reason]
      ));
    } else {
      const dupOf = v.id(req.body?.duplicate_of_investor_id, "existing investor");
      if (dupOf === id) throw httpError(400, "An investor can't be a duplicate of itself.");
      const { rows: target } = await client.query("SELECT id, registration_status FROM investors WHERE id = $1", [dupOf]);
      if (!target[0] || target[0].registration_status === "Duplicate") throw httpError(400, "Pick an existing investor that isn't itself a duplicate.");
      ({ rows: [result] } = await client.query(
        `UPDATE investors SET registration_status = 'Duplicate', duplicate_of_investor_id = $3, rejection_reason = $4,
           reviewed_by = $2, reviewed_at = now(), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, req.user.id, dupOf, reason]
      ));
    }
    await logAudit({ actorId: req.user.id, action: `investor.${decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "marked_duplicate"}`, objectType: "investor", objectId: id, details: reason ? { reason } : {}, req }, client);
    return result;
  });
  res.json({ investor: stripRestricted(investor, await hasRestrictedAccess(req.user.id)) });
}));

router.post("/:id/contacts", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const c = readContact(req.body || {});
  const contact = await inTransaction(pool, async (client) => {
    const { rows: inv } = await client.query("SELECT id FROM investors WHERE id = $1", [id]);
    if (!inv[0]) throw httpError(404, "Investor not found.");
    const { rows: primary } = await client.query("SELECT 1 FROM investor_contacts WHERE investor_id = $1 AND is_primary", [id]);
    const { rows } = await client.query(
      "INSERT INTO investor_contacts (investor_id, name, email, phone, role, is_primary) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [id, c.name, c.email, c.phone, c.role, !primary[0]]
    );
    await logAudit({ actorId: req.user.id, action: "investor.contact_added", objectType: "investor", objectId: id, details: { contact: c.name }, req }, client);
    return rows[0];
  });
  res.status(201).json({ contact });
}));

router.patch("/:id/contacts/:contactId", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const contactId = v.id(req.params.contactId, "contact");
  const changes = readContact(req.body || {}, { partial: true });
  const makePrimary = v.bool(req.body?.is_primary);
  const contact = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM investor_contacts WHERE id = $1 AND investor_id = $2 FOR UPDATE", [contactId, id]);
    const current = rows[0];
    if (!current) throw httpError(404, "Contact not found.");
    if (changes.email !== undefined && changes.email !== current.email && current.user_id) {
      throw httpError(400, "This contact has a login, so their email can't be changed here.");
    }
    if (makePrimary) await client.query("UPDATE investor_contacts SET is_primary = false WHERE investor_id = $1", [id]);
    const cols = Object.keys(changes);
    const sets = [...cols.map((c, i) => `${c} = $${i + 2}`), ...(makePrimary ? ["is_primary = true"] : [])];
    if (!sets.length) return current;
    const { rows: updated } = await client.query(
      `UPDATE investor_contacts SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      [contactId, ...cols.map((c) => changes[c])]
    );
    await logAudit({ actorId: req.user.id, action: "investor.contact_updated", objectType: "investor", objectId: id, details: { contact: updated[0].name }, req }, client);
    return updated[0];
  });
  res.json({ contact });
}));

router.delete("/:id/contacts/:contactId", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const contactId = v.id(req.params.contactId, "contact");
  await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM investor_contacts WHERE id = $1 AND investor_id = $2", [contactId, id]);
    const c = rows[0];
    if (!c) throw httpError(404, "Contact not found.");
    if (c.user_id) throw httpError(400, "This contact has a login. Suspend their login on the Users page instead of removing them.");
    if (c.is_primary) throw httpError(400, "Make another contact primary before removing this one.");
    await client.query("DELETE FROM investor_contacts WHERE id = $1", [contactId]);
    await logAudit({ actorId: req.user.id, action: "investor.contact_removed", objectType: "investor", objectId: id, details: { contact: c.name }, req }, client);
  });
  res.json({ ok: true });
}));

// Invite a contact to the investor portal (PRD 6.14, INV-6). Only for
// approved investors; every invited contact can view, upload and sign.
router.post("/:id/contacts/:contactId/invite", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id);
  const contactId = v.id(req.params.contactId, "contact");
  const { contact, link } = await inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT c.*, i.registration_status, coalesce(i.display_name, i.company, i.legal_name) AS investor_name
       FROM investor_contacts c JOIN investors i ON i.id = c.investor_id
       WHERE c.id = $1 AND c.investor_id = $2 FOR UPDATE OF c`,
      [contactId, id]
    );
    const c = rows[0];
    if (!c) throw httpError(404, "Contact not found.");
    if (c.registration_status !== "Approved") throw httpError(400, "Approve the investor before inviting their contacts.");
    if (!c.email) throw httpError(400, "Add an email for this contact first.");
    const { userId, link } = await provisionLogin(client, {
      existingUserId: c.user_id, email: c.email, name: c.name, role: "investor", company: c.investor_name, invitedBy: req.user.id,
    });
    if (!c.user_id) await client.query("UPDATE investor_contacts SET user_id = $2 WHERE id = $1", [contactId, userId]);
    await logAudit({ actorId: req.user.id, action: c.user_id ? "investor.contact_invite_resent" : "investor.contact_invited", objectType: "investor", objectId: id, details: { contact: c.name }, req }, client);
    return { contact: c, link };
  });
  res.json(await sendInviteEmail({ email: contact.email, name: contact.name, role: "investor", link }));
}));

module.exports = router;
