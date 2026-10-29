// RIV admin endpoints. Every route here requires an active admin.
const { Router } = require("express");
const { pool, USER_ROLES } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { createInviteLink } = require("../lib/invites.js");
const { sendInvite } = require("../lib/email.js");
const { logAudit } = require("../lib/audit.js");

const router = Router();
router.use(requireAuth, requireAdmin);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get("/users", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.name, u.role, u.status, u.company, u.last_login_at, u.created_at,
             (SELECT max(i.expires_at) FROM user_invites i
               WHERE i.user_id = u.id AND i.used_at IS NULL AND i.expires_at > now()) AS invite_expires_at
      FROM users u
      ORDER BY u.created_at DESC
    `);
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

// Invite a new user. The invite email carries a one-time link; if email
// isn't configured (local dev), the link is returned so the admin can copy
// it from the screen.
router.post("/users", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();
    const name = String(req.body?.name || "").trim();
    const role = String(req.body?.role || "");
    const company = String(req.body?.company || "").trim() || null;
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (!name) return res.status(400).json({ error: "Name is required." });
    if (!USER_ROLES.includes(role)) return res.status(400).json({ error: "Choose a role." });

    await client.query("BEGIN");
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "A user with this email already exists." });
    }
    const { rows } = await client.query(
      `INSERT INTO users (email, name, role, company, invited_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role, status, company, created_at`,
      [email, name, role, company, req.user.id]
    );
    const user = rows[0];
    const link = await createInviteLink(client, user.id);
    await logAudit({ actorId: req.user.id, action: "user.invited", objectType: "user", objectId: user.id, details: { email, role }, req }, client);
    await client.query("COMMIT");

    const sent = await sendInvite({ to: email, name, role, link }).catch((err) => ({ error: err.message }));
    res.status(201).json({ user, emailSent: Boolean(sent.sent), inviteLink: sent.sent ? undefined : link, emailError: sent.error });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.post("/users/:id/resend-invite", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id, email, name, role, status FROM users WHERE id = $1", [req.params.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.status !== "invited") return res.status(400).json({ error: "This user has already accepted their invite." });

    const link = await createInviteLink(pool, user.id);
    await logAudit({ actorId: req.user.id, action: "user.invite_resent", objectType: "user", objectId: user.id, req });
    const sent = await sendInvite({ to: user.email, name: user.name, role: user.role, link }).catch((err) => ({ error: err.message }));
    res.json({ emailSent: Boolean(sent.sent), inviteLink: sent.sent ? undefined : link, emailError: sent.error });
  } catch (err) {
    next(err);
  }
});

// Suspend or reactivate. A user who never set a password goes back to
// 'invited' rather than 'active' when reactivated.
router.patch("/users/:id/status", async (req, res, next) => {
  try {
    const target = req.body?.status;
    if (!["active", "suspended"].includes(target)) return res.status(400).json({ error: "Status must be active or suspended." });
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "You can't change your own status." });

    const { rows } = await pool.query(
      `UPDATE users
       SET status = CASE WHEN $2 = 'active' AND password_hash IS NULL THEN 'invited' ELSE $2 END,
           updated_at = now()
       WHERE id = $1
       RETURNING id, email, name, role, status, company`,
      [req.params.id, target]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found." });
    await logAudit({ actorId: req.user.id, action: target === "suspended" ? "user.suspended" : "user.reactivated", objectType: "user", objectId: user.id, req });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.get("/audit", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.object_type, a.object_id, a.details, a.ip, a.created_at,
              u.name AS actor_name, u.email AS actor_email
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ entries: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
