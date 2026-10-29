// Sign-in (password + emailed code), invite acceptance and password reset.
// See docs/TECH-SPEC.md section 4.
const { Router } = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db.js");
const { requireAuth, signToken } = require("../middleware/auth.js");
const { randomToken, sha256, sixDigitCode, hashCode, safeEqual } = require("../lib/tokens.js");
const { sendLoginCode, sendPasswordReset, appUrl, isProduction } = require("../lib/email.js");
const { logAudit } = require("../lib/audit.js");
const { hit } = require("../lib/rateLimit.js");

const router = Router();

const CODE_TTL_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;
const RESEND_WAIT_SECONDS = 30;
const RESET_TTL_MINUTES = 60;
const MIN_PASSWORD_LENGTH = 10;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function normalizeEmail(email) {
  return String(email || "").toLowerCase().trim();
}

function maskEmail(email) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function passwordProblem(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "Password is too long.";
  return null;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, company: u.company };
}

// Creates a login challenge for a user whose password just checked out and
// emails the code. Returns the challenge id the browser sends back with the
// code.
async function issueChallenge(user) {
  const challengeId = randomToken(24);
  const code = sixDigitCode();
  await pool.query(
    `INSERT INTO login_codes (user_id, challenge_id, code_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [user.id, challengeId, hashCode(challengeId, code), CODE_TTL_MINUTES]
  );
  const result = await sendLoginCode({ to: user.email, name: user.name, code });
  if (result.skipped && isProduction()) {
    const err = new Error("Sign-in codes can't be emailed right now. Please contact RIV.");
    err.status = 503;
    throw err;
  }
  return challengeId;
}

router.post("/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
    if (!hit(`login:${req.ip}:${email}`, { limit: 10, windowMs: FIFTEEN_MINUTES })) {
      return res.status(429).json({ error: "Too many sign-in attempts. Please wait 15 minutes and try again." });
    }

    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = rows[0];
    if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      await logAudit({ actorId: user?.id ?? null, action: "auth.login_failed", objectType: "user", objectId: user?.id ?? null, details: { email, reason: "bad_credentials" }, req });
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    if (user.status !== "active") {
      await logAudit({ actorId: user.id, action: "auth.login_failed", objectType: "user", objectId: user.id, details: { reason: `status_${user.status}` }, req });
      return res.status(403).json({ error: "This account is suspended. Please contact RIV." });
    }

    const challengeId = await issueChallenge(user);
    res.json({ challengeId, sentTo: maskEmail(user.email) });
  } catch (err) {
    next(err);
  }
});

router.post("/verify-code", async (req, res, next) => {
  try {
    const challengeId = String(req.body?.challengeId || "");
    const code = String(req.body?.code || "").replace(/\s/g, "");
    if (!challengeId || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the 6-digit code from your email." });
    if (!hit(`verify:${req.ip}`, { limit: 30, windowMs: FIFTEEN_MINUTES })) {
      return res.status(429).json({ error: "Too many attempts. Please wait 15 minutes and try again." });
    }

    // Count the attempt first, atomically, so parallel guesses can't get
    // past the limit.
    const { rows } = await pool.query(
      `UPDATE login_codes SET attempts = attempts + 1
       WHERE challenge_id = $1 AND used_at IS NULL AND expires_at > now() AND attempts < $2
       RETURNING id, user_id, code_hash, attempts`,
      [challengeId, CODE_MAX_ATTEMPTS]
    );
    const challenge = rows[0];
    if (!challenge) {
      return res.status(400).json({ error: "This code has expired or been used too many times. Please sign in again.", restart: true });
    }
    if (!safeEqual(hashCode(challengeId, code), challenge.code_hash)) {
      const left = CODE_MAX_ATTEMPTS - challenge.attempts;
      await logAudit({ actorId: challenge.user_id, action: "auth.code_failed", objectType: "user", objectId: challenge.user_id, details: { attemptsLeft: left }, req });
      return res.status(401).json({
        error: left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn't right. Please sign in again.",
        restart: left <= 0,
      });
    }

    const used = await pool.query("UPDATE login_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id", [challenge.id]);
    if (!used.rows[0]) return res.status(400).json({ error: "This code has already been used. Please sign in again.", restart: true });

    const { rows: users } = await pool.query(
      "UPDATE users SET last_login_at = now() WHERE id = $1 AND status = 'active' RETURNING *",
      [challenge.user_id]
    );
    const user = users[0];
    if (!user) return res.status(403).json({ error: "This account is not active. Please contact RIV.", restart: true });

    await logAudit({ actorId: user.id, action: "auth.login", objectType: "user", objectId: user.id, req });
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/resend-code", async (req, res, next) => {
  try {
    const challengeId = String(req.body?.challengeId || "");
    const { rows } = await pool.query(
      `SELECT lc.id, lc.created_at, u.id AS user_id, u.email, u.name, u.status
       FROM login_codes lc JOIN users u ON u.id = lc.user_id
       WHERE lc.challenge_id = $1 AND lc.used_at IS NULL AND lc.expires_at > now()`,
      [challengeId]
    );
    const old = rows[0];
    if (!old || old.status !== "active") return res.status(400).json({ error: "Please sign in again.", restart: true });
    if (Date.now() - new Date(old.created_at).getTime() < RESEND_WAIT_SECONDS * 1000) {
      return res.status(429).json({ error: `Please wait ${RESEND_WAIT_SECONDS} seconds before asking for a new code.` });
    }
    await pool.query("UPDATE login_codes SET used_at = now() WHERE id = $1", [old.id]);
    const newChallengeId = await issueChallenge({ id: old.user_id, email: old.email, name: old.name });
    res.json({ challengeId: newChallengeId, sentTo: maskEmail(old.email) });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Lets the invite page greet the user by name before they set a password.
router.get("/invite", async (req, res, next) => {
  try {
    const token = String(req.query.token || "");
    const { rows } = await pool.query(
      `SELECT u.email, u.name, u.role FROM user_invites i JOIN users u ON u.id = i.user_id
       WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now() AND u.status = 'invited'`,
      [sha256(token)]
    );
    if (!rows[0]) return res.status(404).json({ error: "This invite link has expired or was already used. Ask RIV to send a new one." });
    res.json({ invite: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post("/accept-invite", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const token = String(req.body?.token || "");
    const problem = passwordProblem(req.body?.password);
    if (problem) return res.status(400).json({ error: problem });

    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT i.id AS invite_id, u.id AS user_id FROM user_invites i JOIN users u ON u.id = i.user_id
       WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now() AND u.status = 'invited'
       FOR UPDATE OF i`,
      [sha256(token)]
    );
    const invite = rows[0];
    if (!invite) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "This invite link has expired or was already used. Ask RIV to send a new one." });
    }
    await client.query("UPDATE user_invites SET used_at = now() WHERE id = $1", [invite.invite_id]);
    await client.query(
      "UPDATE users SET password_hash = $1, status = 'active', updated_at = now() WHERE id = $2",
      [bcrypt.hashSync(req.body.password, 10), invite.user_id]
    );
    await logAudit({ actorId: invite.user_id, action: "auth.invite_accepted", objectType: "user", objectId: invite.user_id, req }, client);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Same reply whether or not the email exists, so this can't be used to find
// out who has an account.
router.post("/forgot", async (req, res, next) => {
  const reply = () => res.json({ ok: true, message: "If an active account exists for that email, a reset link is on its way. It's valid for 1 hour." });
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !hit(`forgot:${email}`, { limit: 3, windowMs: ONE_HOUR })) return reply();

    const { rows } = await pool.query("SELECT id, email, name FROM users WHERE email = $1 AND status = 'active'", [email]);
    const user = rows[0];
    if (!user) return reply();

    await pool.query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
    const token = randomToken();
    await pool.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [user.id, sha256(token), RESET_TTL_MINUTES]
    );
    await sendPasswordReset({ to: user.email, name: user.name, link: appUrl(`/reset-password?token=${encodeURIComponent(token)}`) });
    await logAudit({ actorId: user.id, action: "auth.password_reset_requested", objectType: "user", objectId: user.id, req });
    reply();
  } catch (err) {
    next(err);
  }
});

router.post("/reset", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const token = String(req.body?.token || "");
    const problem = passwordProblem(req.body?.password);
    if (problem) return res.status(400).json({ error: problem });

    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT r.id AS reset_id, u.id AS user_id FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now() AND u.status = 'active'
       FOR UPDATE OF r`,
      [sha256(token)]
    );
    const reset = rows[0];
    if (!reset) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "This reset link has expired or was already used. Please request a new one." });
    }
    await client.query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [reset.user_id]);
    await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [bcrypt.hashSync(req.body.password, 10), reset.user_id]);
    await logAudit({ actorId: reset.user_id, action: "auth.password_reset", objectType: "user", objectId: reset.user_id, req }, client);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
