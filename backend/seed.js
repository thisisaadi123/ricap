// Demo accounts for local development only. Safe to re-run: existing
// accounts are left as they are. Sign-in still needs the emailed code; with
// Resend unset, the code is printed in the backend terminal.
require("dotenv/config");
const bcrypt = require("bcryptjs");
const { pool, runMigrations } = require("./db.js");

const DEMO_USERS = [
  { email: "admin@ricap.demo", password: "admin-demo-123", name: "RIV Admin", role: "admin", company: "Retail Innovation Ventures" },
  { email: "partner@ricap.demo", password: "partner-demo-123", name: "Demo Venture Partner", role: "partner", company: "Demo Partners LLC" },
  { email: "investor@ricap.demo", password: "investor-demo-123", name: "Demo Investor", role: "investor", company: "Demo Family Office" },
];

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
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
