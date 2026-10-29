// One-time invite links (PRD 6.1, 6.14: every account is invite-only).
const { randomToken, sha256 } = require("./tokens.js");
const { appUrl } = require("./email.js");

const INVITE_TTL_HOURS = 72;

// Issues a fresh invite link for a user and voids any earlier unused ones,
// so only the newest link works. Pass a pg client to run inside a
// transaction.
async function createInviteLink(db, userId) {
  await db.query("UPDATE user_invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
  const token = randomToken();
  await db.query(
    `INSERT INTO user_invites (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [userId, sha256(token), INVITE_TTL_HOURS]
  );
  return appUrl(`/accept-invite?token=${encodeURIComponent(token)}`);
}

module.exports = { createInviteLink, INVITE_TTL_HOURS };
