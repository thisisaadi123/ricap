// Demo accounts for local development only. Safe to re-run: existing
// records are left as they are. Sign-in still needs the emailed code; with
// Resend unset, the code is printed in the backend terminal.
require("dotenv/config");
const bcrypt = require("bcryptjs");
const { pool, runMigrations } = require("./db.js");

const DEMO_USERS = [
  { email: "admin@ricap.demo", password: "admin-demo-123", name: "RIV Admin", role: "admin", company: "Retail Innovation Ventures" },
  { email: "partner@ricap.demo", password: "partner-demo-123", name: "Demo Venture Partner", role: "partner", company: "Demo Partners LLC" },
  { email: "investor@ricap.demo", password: "investor-demo-123", name: "Demo Investor", role: "investor", company: "Demo Family Office" },
];

async function userId(email) {
  const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  return rows[0].id;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo accounts with NODE_ENV=production.");
  }
  await runMigrations();
  for (const u of DEMO_USERS) {
    const { rowCount } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, status, company)
       VALUES ($1, $2, $3, $4, 'active', $5)
       ON CONFLICT (email) DO NOTHING`,
      [u.email, bcrypt.hashSync(u.password, 10), u.name, u.role, u.company]
    );
    console.log(`${rowCount ? "Created" : "Exists "}  ${u.role.padEnd(8)} ${u.email}  /  ${u.password}`);
  }

  // The demo admin can see restricted data (KYC, net worth).
  await pool.query("UPDATE users SET restricted_access = true WHERE email = 'admin@ricap.demo'");

  // The demo partner's onboarded partner record (M1).
  const partnerUser = await userId("partner@ricap.demo");
  await pool.query(
    `INSERT INTO venture_partners (user_id, full_name, company, email, regions, sectors, tier, investor_reach_count,
       investor_network_types, onboarding_stage, agreement_signed_date)
     VALUES ($1, 'Demo Venture Partner', 'Demo Partners LLC', 'partner@ricap.demo', '{UAE,India}', '{Grocery,Fashion}', 'Tier 2', 25,
       '{HNW,"Family offices"}', 'Onboarded', current_date)
     ON CONFLICT (email) DO NOTHING`,
    [partnerUser]
  );

  // The demo investor: an approved entity whose primary contact is the demo
  // investor login (M1, M2).
  const investorUser = await userId("investor@ricap.demo");
  const { rows: linked } = await pool.query("SELECT 1 FROM investor_contacts WHERE user_id = $1", [investorUser]);
  if (!linked[0]) {
    const admin = await userId("admin@ricap.demo");
    const { rows } = await pool.query(
      `INSERT INTO investors (kind, legal_name, company, category, country, ticket_min, ticket_max, destinations,
         source, registration_status, reviewed_by, reviewed_at, submitted_by_user_id)
       VALUES ('Entity', 'Demo Family Office LLC', 'Demo Family Office', 'Family office', 'UAE', 250000, 1000000,
         '{HoldCo,Fund}', 'RIV direct', 'Approved', $1, now(), $1) RETURNING id`,
      [admin]
    );
    await pool.query(
      `INSERT INTO investor_contacts (investor_id, name, email, role, is_primary, user_id)
       VALUES ($1, 'Demo Investor', 'investor@ricap.demo', 'Signatory', true, $2)`,
      [rows[0].id, investorUser]
    );
    console.log("Created  demo investor record (Demo Family Office LLC) linked to investor@ricap.demo");
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
