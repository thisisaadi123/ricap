// Maps a signed-in user to the record they act for: a venture partner
// record (partner role) or an investor via one of its contacts (investor
// role, INV-6).
const { pool } = require("../db.js");
const { httpError } = require("./http.js");

async function partnerForUser(userId) {
  const { rows } = await pool.query("SELECT * FROM venture_partners WHERE user_id = $1", [userId]);
  if (!rows[0]) throw httpError(403, "Your partner profile isn't set up yet. Please contact RIV.");
  if (rows[0].status !== "Active") throw httpError(403, "Your partner profile is inactive. Please contact RIV.");
  return rows[0];
}

async function investorForUser(userId) {
  const { rows } = await pool.query(
    `SELECT i.*, c.id AS contact_id, c.role AS contact_role
     FROM investor_contacts c JOIN investors i ON i.id = c.investor_id
     WHERE c.user_id = $1`,
    [userId]
  );
  if (!rows[0]) throw httpError(403, "Your investor profile isn't set up yet. Please contact RIV.");
  if (rows[0].registration_status !== "Approved") throw httpError(403, "Your investor profile isn't active. Please contact RIV.");
  return rows[0];
}

// Admins can see restricted data (net worth, KYC) only with this flag.
async function hasRestrictedAccess(userId) {
  const { rows } = await pool.query("SELECT restricted_access FROM users WHERE id = $1", [userId]);
  return Boolean(rows[0]?.restricted_access);
}

function requireRestricted() {
  return async (req, res, next) => {
    try {
      if (!(await hasRestrictedAccess(req.user.id))) {
        return res.status(403).json({ error: "KYC and other restricted data need restricted access. Ask an admin who has it to grant it on the Users page." });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { partnerForUser, investorForUser, hasRestrictedAccess, requireRestricted };
