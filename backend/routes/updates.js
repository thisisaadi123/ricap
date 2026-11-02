// Investor updates (PRD 6.10, 8.10). Mounted at /api/admin/updates; admin only.
// A draft goes out to the investors in its vehicle or deal, or a selected
// subset of them, in the portal with an email alert.
const { Router } = require("express");
const { pool } = require("../db.js");
const { requireAuth, requireAdmin } = require("../middleware/auth.js");
const { asyncRoute, httpError, inTransaction } = require("../lib/http.js");
const v = require("../lib/validate.js");
const { logAudit } = require("../lib/audit.js");
const { notifyInvestor, notifyPartner } = require("../lib/notify.js");
const { statementFor } = require("../lib/statements.js");
const { stageIndex } = require("../lib/commitments.js");

const router = Router();
router.use(requireAuth, requireAdmin);

const UPDATE_TYPES = ["Monthly letter", "Quarterly account statement", "Deal update", "Notice", "Event"];

// "In the vehicle" means a live commitment past Eligible: offer documents
// issued, soft commitment recorded or NDA signed. Someone who has only said
// they're interested shouldn't get confidential letters or deal news.
async function investorsInScope(db, vehicleId) {
  const { rows } = await db.query(
    `SELECT c.investor_id AS id, c.flow, c.stage, c.status, coalesce(i.display_name, i.legal_name) AS name, i.partner_id
     FROM commitments c JOIN investors i ON i.id = c.investor_id
     WHERE c.vehicle_id = $1 AND c.status IN ('Active', 'On hold') ORDER BY name`,
    [vehicleId]
  );
  return rows.filter((r) => stageIndex(r.flow, r.stage) >= 2);
}

function readUpdate(b, { partial }) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k) || !partial;
  if (has("type")) out.type = v.oneOf(b.type, UPDATE_TYPES, "Type", { required: true });
  if (has("vehicle_id")) out.vehicle_id = v.id(b.vehicle_id, "vehicle or deal");
  if (has("title")) out.title = v.text(b.title, "Title", { required: true, max: 300 });
  if (has("body")) out.body = v.text(b.body, "Text", { required: true, max: 20000 });
  if (has("audience")) out.audience = v.oneOf(b.audience || "All", ["All", "Selected"], "Audience", { required: true });
  if (has("selected_investor_ids")) {
    if (b.selected_investor_ids !== undefined && !Array.isArray(b.selected_investor_ids)) throw httpError(400, "Choose the investors from the list.");
    out.selected_investor_ids = (b.selected_investor_ids || []).map((id) => v.id(id, "investor"));
  }
  if (has("shareable_with_partners")) out.shareable_with_partners = Boolean(v.bool(b.shareable_with_partners));
  return out;
}

const SELECT_SQL = `
  SELECT u.*, veh.name AS vehicle_name, veh.type AS vehicle_type, cu.name AS created_by_name, pu.name AS published_by_name,
         (SELECT count(*)::int FROM update_deliveries d WHERE d.update_id = u.id) AS delivered,
         (SELECT count(*)::int FROM update_deliveries d WHERE d.update_id = u.id AND d.first_read_at IS NOT NULL) AS read_count
  FROM investor_updates u
  JOIN vehicles veh ON veh.id = u.vehicle_id
  LEFT JOIN users cu ON cu.id = u.created_by
  LEFT JOIN users pu ON pu.id = u.published_by`;

router.get("/", asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`${SELECT_SQL} ORDER BY coalesce(u.published_at, u.updated_at) DESC`);
  res.json({ updates: rows });
}));

// Anything an update can be about: HoldCo, Fund and IB deals.
router.get("/targets", asyncRoute(async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, type, status FROM vehicles ORDER BY id");
  res.json({ targets: rows });
}));

router.get("/audience", asyncRoute(async (req, res) => {
  const people = await investorsInScope(pool, v.id(req.query.vehicle_id, "vehicle or deal"));
  res.json({ investors: people.map((p) => ({ id: p.id, name: p.name, stage: p.stage, status: p.status })) });
}));

// One investor's record: their statement and the updates logged against them.
router.get("/investor/:investorId", asyncRoute(async (req, res) => {
  const investorId = v.id(req.params.investorId, "investor");
  const asOf = v.date(req.query.as_of, "As-of date") || new Date().toISOString().slice(0, 10);
  const { rows: deliveries } = await pool.query(
    `SELECT u.id, u.type, u.title, u.status, veh.name AS vehicle_name, d.delivered_at, d.first_read_at
     FROM update_deliveries d JOIN investor_updates u ON u.id = d.update_id JOIN vehicles veh ON veh.id = u.vehicle_id
     WHERE d.investor_id = $1 ORDER BY d.delivered_at DESC`,
    [investorId]
  );
  res.json({ statement: await statementFor(pool, investorId, asOf), updates: deliveries });
}));

router.post("/", asyncRoute(async (req, res) => {
  const u = readUpdate(req.body || {}, { partial: false });
  const { rows: veh } = await pool.query("SELECT id FROM vehicles WHERE id = $1", [u.vehicle_id]);
  if (!veh[0]) throw httpError(404, "Vehicle or deal not found.");
  const update = await inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO investor_updates (type, vehicle_id, title, body, audience, selected_investor_ids, shareable_with_partners, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [u.type, u.vehicle_id, u.title, u.body, u.audience, u.selected_investor_ids, u.shareable_with_partners, req.user.id]
    );
    await logAudit({ actorId: req.user.id, action: "update.drafted", objectType: "update", objectId: rows[0].id, details: { title: u.title }, req }, client);
    return rows[0];
  });
  res.status(201).json({ update });
}));

router.get("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "update");
  const { rows } = await pool.query(`${SELECT_SQL} WHERE u.id = $1`, [id]);
  if (!rows[0]) throw httpError(404, "Update not found.");
  // Delivery log (PRD 8.10): per recipient, read state and email status.
  const { rows: deliveries } = await pool.query(
    `SELECT d.investor_id, coalesce(i.display_name, i.legal_name) AS investor_name, d.delivered_at, d.first_read_at,
            coalesce((SELECT json_agg(json_build_object('email', us.email, 'email_status', n.email_status) ORDER BY us.email)
                      FROM investor_contacts c
                      JOIN users us ON us.id = c.user_id
                      JOIN notifications n ON n.user_id = us.id AND n.type = 'update' AND n.link_id = d.update_id
                      WHERE c.investor_id = d.investor_id), '[]') AS recipients
     FROM update_deliveries d JOIN investors i ON i.id = d.investor_id
     WHERE d.update_id = $1 ORDER BY investor_name`,
    [id]
  );
  res.json({ update: rows[0], deliveries });
}));

router.patch("/:id", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "update");
  const changes = readUpdate(req.body || {}, { partial: true });
  const cols = Object.keys(changes);
  if (!cols.length) throw httpError(400, "Nothing to change.");
  const { rows } = await pool.query(
    `UPDATE investor_updates SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now()
     WHERE id = $1 AND status = 'Draft' RETURNING *`,
    [id, ...cols.map((c) => changes[c])]
  );
  if (!rows[0]) throw httpError(400, "Only drafts can be edited.");
  res.json({ update: rows[0] });
}));

router.post("/:id/publish", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "update");
  const update = await inTransaction(pool, async (client) => {
    const { rows } = await client.query("SELECT * FROM investor_updates WHERE id = $1 FOR UPDATE", [id]);
    const u = rows[0];
    if (!u) throw httpError(404, "Update not found.");
    if (u.status !== "Draft") throw httpError(400, "This update has already been published or withdrawn.");
    const everyone = await investorsInScope(client, u.vehicle_id);
    const recipients = u.audience === "Selected" ? everyone.filter((p) => u.selected_investor_ids.includes(p.id)) : everyone;
    if (!recipients.length) throw httpError(400, "No investors to send this to. Only investors past the Eligible stage in this vehicle or deal can receive updates.");
    const { rows: published } = await client.query(
      "UPDATE investor_updates SET status = 'Published', published_by = $2, published_at = now(), updated_at = now() WHERE id = $1 RETURNING *", [id, req.user.id]
    );
    const byPartner = new Map();
    for (const p of recipients) {
      await client.query("INSERT INTO update_deliveries (update_id, investor_id) VALUES ($1, $2)", [id, p.id]);
      // The email says there's something new; the text stays in the portal.
      await notifyInvestor(client, p.id, {
        type: "update", title: `New from RIV: ${u.title}`, body: u.type, linkView: "updates", linkId: id,
        email: true, emailSubject: `New on RICap: ${u.title}`, emailBody: `RIV has published a new ${u.type.toLowerCase()} for you. Sign in to read it under Updates.`,
      });
      if (p.partner_id) byPartner.set(p.partner_id, (byPartner.get(p.partner_id) || 0) + 1);
    }
    for (const [partnerId, count] of byPartner) {
      await notifyPartner(client, partnerId, {
        type: "update_partner", title: `An update went out to ${count} of your investors`,
        body: u.shareable_with_partners ? u.title : u.type, linkView: "updates", linkId: id,
      });
    }
    await logAudit({ actorId: req.user.id, action: "update.published", objectType: "update", objectId: id, details: { title: u.title, recipients: recipients.length }, req }, client);
    return published[0];
  });
  res.json({ update });
}));

// Published updates stay on record but disappear from the portals.
router.post("/:id/withdraw", asyncRoute(async (req, res) => {
  const id = v.id(req.params.id, "update");
  const reason = v.text(req.body?.reason, "Reason", { required: true, max: 1000 });
  const { rows } = await pool.query(
    `UPDATE investor_updates SET status = 'Withdrawn', withdraw_reason = $2, withdrawn_by = $3, withdrawn_at = now(), updated_at = now()
     WHERE id = $1 AND status <> 'Withdrawn' RETURNING *`,
    [id, reason, req.user.id]
  );
  if (!rows[0]) throw httpError(400, "Already withdrawn.");
  await logAudit({ actorId: req.user.id, action: "update.withdrawn", objectType: "update", objectId: id, details: { reason }, req });
  res.json({ update: rows[0] });
}));

module.exports = router;
