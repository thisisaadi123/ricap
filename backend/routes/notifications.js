// In-app alerts for whoever is signed in. Mounted at /api/notifications.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth } = require("../middleware/auth.js");
const { asyncRoute } = require("../lib/http.js");
const v = require("../lib/validate.js");

const router = Router();
router.use(requireAuth);

router.get("/", asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, type, title, body, link_view, link_id, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 30",
    [req.user.id]
  );
  const { rows: unread } = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [req.user.id]);
  res.json({ notifications: rows, unread: unread[0].n });
}));

router.get("/unread", asyncRoute(async (req, res) => {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [req.user.id]);
  res.json({ unread: rows[0].n });
}));

router.post("/read-all", asyncRoute(async (req, res) => {
  await pool.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [req.user.id]);
  res.json({ ok: true });
}));

router.post("/:id/read", asyncRoute(async (req, res) => {
  await pool.query("UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2", [v.id(req.params.id, "alert"), req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
