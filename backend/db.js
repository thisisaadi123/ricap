// RICap database: connection pool + migration runner.
//
// Unlike RISE (which edits CREATE TABLE IF NOT EXISTS / ALTER ... IF NOT
// EXISTS statements in place inside db.js), every schema change here is a
// numbered file in ./migrations, applied exactly once and in order, and
// recorded in schema_migrations. RISE's approach silently skips changed
// CHECK constraints on databases that already have the table; RICap holds
// money and legal records, so schema changes must be explicit.
//
// To change the schema: add a new file (e.g. 002_people.sql). Never edit a
// migration that has already been applied anywhere.
const fs = require("fs");
const path = require("path");
const pg = require("pg");

const { Pool } = pg;

// Same Supabase-vs-local SSL auto-detection as RISE and RIOS.
function wantsSsl() {
  if (process.env.PGSSL === "true") return true;
  if (process.env.PGSSL === "false") return false;
  const url = process.env.DATABASE_URL || "";
  return url.includes("supabase.co") || url.includes("supabase.com");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: wantsSsl() ? { rejectUnauthorized: false } : false,
});
// An idle connection can drop (database restart, network, pooler timeout).
// The pool replaces it; without this listener the error would end the process.
pool.on("error", (err) => console.error(`Database connection dropped: ${err.message}`));

const USER_ROLES = ["admin", "partner", "investor"];
const USER_STATUSES = ["invited", "active", "suspended"];

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
// Arbitrary constant: an advisory lock so two cold-starting Netlify
// functions can't apply the same migration at the same time.
const MIGRATION_LOCK_ID = 727001;

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Applied migration ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { pool, runMigrations, USER_ROLES, USER_STATUSES };
