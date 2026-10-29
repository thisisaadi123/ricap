// Emails to an investor's contacts who have a portal login. In-app
// notifications arrive with M6; until then email is the only channel.
const { pool } = require("../db.js");
const { sendEmail, appUrl, isProduction } = require("./email.js");

async function emailInvestorUsers(investorId, subject, body) {
  const { rows } = await pool.query(
    `SELECT u.email, u.name FROM investor_contacts c JOIN users u ON u.id = c.user_id
     WHERE c.investor_id = $1 AND u.status = 'active'`,
    [investorId]
  );
  for (const u of rows) {
    const text = `Hi ${u.name},\n\n${body}\n\nSign in to RICap: ${appUrl("/")}\n\nRetail Innovation Ventures`;
    const result = await sendEmail({ to: u.email, subject, text }).catch((err) => {
      console.error(`Email to ${u.email} failed: ${err.message}`);
      return {};
    });
    if (result.skipped && !isProduction()) console.log(`[dev] Email to ${u.email}: ${subject}`);
  }
  return rows.length;
}

module.exports = { emailInvestorUsers };
