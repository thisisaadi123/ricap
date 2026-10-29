// Creates (or re-invites) the RICap login behind a partner or investor
// contact. Shared by partner onboarding (PRD 6.1) and investor invites
// (PRD 6.14).
const { httpError } = require("./http.js");
const { createInviteLink } = require("./invites.js");
const { sendInvite } = require("./email.js");

const ROLE_NAMES = { admin: "an admin", partner: "a venture partner", investor: "an investor" };

// Runs inside the caller's transaction. Returns { userId, link }; the
// caller sends the invite email after committing (see sendInviteEmail).
async function provisionLogin(client, { existingUserId, email, name, role, company, invitedBy }) {
  if (existingUserId) {
    const { rows } = await client.query("SELECT id, status FROM users WHERE id = $1", [existingUserId]);
    const user = rows[0];
    if (user && user.status !== "invited") throw httpError(400, "This person already has an active login. Use password reset if they're locked out.");
    if (user) return { userId: user.id, link: await createInviteLink(client, user.id) };
  }

  const { rows: taken } = await client.query("SELECT id, role FROM users WHERE email = $1", [email]);
  if (taken[0]) throw httpError(409, `${email} already has a RICap login as ${ROLE_NAMES[taken[0].role]}. Each login has one role.`);

  const { rows } = await client.query(
    "INSERT INTO users (email, name, role, company, invited_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [email, name, role, company, invitedBy]
  );
  return { userId: rows[0].id, link: await createInviteLink(client, rows[0].id) };
}

// Returns the JSON the admin screens expect: in local dev without email,
// the link itself so the admin can share it.
async function sendInviteEmail({ email, name, role, link }) {
  const sent = await sendInvite({ to: email, name, role, link }).catch((err) => ({ error: err.message }));
  return { emailSent: Boolean(sent.sent), inviteLink: sent.sent ? undefined : link, emailError: sent.error };
}

module.exports = { provisionLogin, sendInviteEmail };
