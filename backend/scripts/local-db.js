// Local Postgres for development before the Supabase project exists.
// Runs a real Postgres on this machine (embedded-postgres downloads the
// binaries once) and keeps its data in backend/.localdb between runs.
//
//   npm run db:local     start it (leave the terminal open; Ctrl-C stops it)
//
// Then in backend/.env:
//   DATABASE_URL=postgresql://ricap:ricap-local@localhost:54329/ricap
//   PGSSL=false
//
// To start again from an empty database, stop it and delete backend/.localdb.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", ".localdb");
const PORT = 54329;

async function main() {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: "ricap", password: "ricap-local", port: PORT, persistent: true });
  const fresh = !fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("ricap");
  console.log(`Local Postgres ${fresh ? "created and " : ""}running on port ${PORT}.`);
  console.log(`DATABASE_URL=postgresql://ricap:ricap-local@localhost:${PORT}/ricap  (with PGSSL=false)`);
  console.log("Leave this running. Press Ctrl-C to stop.");

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error("Couldn't start the local database:", err.message);
  process.exit(1);
});
