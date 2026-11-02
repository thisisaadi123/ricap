// Alerts (PRD 8.13; in-app and email only, TECH-4). notifyX() inserts rows
// using the caller's transaction, so an alert exists only if the action it
// describes committed. flushEmails() then sends what's pending; app.js runs
// it before answering each write request, because the hosted backend stops
// working once it has responded. Anything left over or failed goes out with
// a later request.
//
// Never put bank details in an email: they only come from the portal (PRD 7).
const { pool } = require("../db.js");
const { sendEmail, appUrl, isProduction } = require("./email.js");

const MAX_ATTEMPTS = 3;
const FLUSH_BUDGET_MS = 8000;

async function notifyUsers(db, userIds, { type, title, body = null, linkView = null, linkId = null, email = false, emailSubject = null, emailBody = null }) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return 0;
  await db.query(
    `INSERT INTO notifications (user_id, type, title, body, link_view, link_id, email_status, email_subject, email_body)
     SELECT u.id, $2::text, $3::text, $4::text, $5::text, $6::int, $7::text, $8::text, $9::text FROM users u WHERE u.id = ANY($1) AND u.status = 'active'`,
    [ids, type, title, body, linkView, linkId, email ? "Pending" : "None", email ? emailSubject || title : null, email ? emailBody || body || title : null]
  );
  return ids.length;
}

// Every contact of the investor who has a portal login.
async function notifyInvestor(db, investorId, message) {
  const { rows } = await db.query("SELECT user_id FROM investor_contacts WHERE investor_id = $1 AND user_id IS NOT NULL", [investorId]);
  return notifyUsers(db, rows.map((r) => r.user_id), message);
}

async function notifyPartner(db, partnerId, message) {
  if (!partnerId) return 0;
  const { rows } = await db.query("SELECT user_id FROM venture_partners WHERE id = $1 AND user_id IS NOT NULL", [partnerId]);
  return notifyUsers(db, rows.map((r) => r.user_id), message);
}

async function notifyAdmins(db, message, { exceptUserId = null } = {}) {
  const { rows } = await db.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  return notifyUsers(db, rows.map((r) => r.id).filter((id) => id !== exceptUserId), message);
}

async function sendOne(row) {
  if (row.user_status !== "active") return "Skipped";
  const text = `Hi ${row.name},\n\n${row.email_body}\n\nSign in to RICap: ${appUrl("/")}\n\nRetail Innovation Ventures`;
  try {
    const result = await sendEmail({ to: row.email, subject: row.email_subject, text });
    if (result.skipped) {
      if (!isProduction()) console.log(`[dev] Email to ${row.email}: ${row.email_subject}`);
      return "Skipped";
    }
    return "Sent";
  } catch (err) {
    console.error(`Email to ${row.email} failed: ${err.message}`);
    return row.email_attempts >= MAX_ATTEMPTS ? "Failed" : "Pending";
  }
}

// SKIP LOCKED lets two requests flush at once without double-sending. A row
// stuck in Sending (the process died mid-send) is picked up after 10 minutes.
async function flushEmails() {
  const started = Date.now();
  while (Date.now() - started < FLUSH_BUDGET_MS) {
    const { rows } = await pool.query(
      `UPDATE notifications n SET email_status = 'Sending', email_claimed_at = now(), email_attempts = n.email_attempts + 1
       FROM users u
       WHERE u.id = n.user_id AND n.id IN (
         SELECT id FROM notifications
         WHERE email_status = 'Pending' OR (email_status = 'Sending' AND email_claimed_at < now() - interval '10 minutes')
         ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
       RETURNING n.id, n.email_subject, n.email_body, n.email_attempts, u.email, u.name, u.status AS user_status`
    );
    if (!rows.length) return;
    let progressed = false;
    for (const row of rows) {
      const status = await sendOne(row);
      if (status !== "Pending") progressed = true;
      await pool.query("UPDATE notifications SET email_status = $2, emailed_at = CASE WHEN $2 = 'Sent' THEN now() END WHERE id = $1", [row.id, status]);
    }
    // Email provider down: stop and let a later request retry.
    if (!progressed) return;
  }
}

// Express middleware: send pending emails before answering a write request.
function flushEmailsAfterWrites(req, res, next) {
  if (req.method === "GET") return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    flushEmails().catch((err) => console.error(`Email flush failed: ${err.message}`)).finally(() => json(body));
    return res;
  };
  next();
}

module.exports = { notifyUsers, notifyInvestor, notifyPartner, notifyAdmins, flushEmails, flushEmailsAfterWrites };
