const express = require("express");
const path = require("path");

const { runMigrations } = require("./db.js");
const authRoutes = require("./routes/auth.js");
const adminRoutes = require("./routes/admin.js");

const app = express();
app.disable("x-powered-by");
// Netlify sits one hop in front of Express and appends the real client IP
// to X-Forwarded-For. Trusting exactly one hop makes req.ip that value
// (used by rate limits and the audit log) without letting a client spoof it
// by sending its own X-Forwarded-For.
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

// The frontend is served from the same origin in dev (Vite proxy) and in
// production (Netlify redirect), so no CORS is needed. Keep it that way:
// leaving CORS off means other sites can't call this API from a browser.

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

const frontendDist = path.join(__dirname, "../frontend/dist");
app.use(express.static(frontendDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.status === 503) return res.status(503).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

let schemaReady;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = runMigrations().catch((err) => {
      schemaReady = null; // let the next request retry instead of caching the failure
      throw err;
    });
  }
  return schemaReady;
}

module.exports = { app, ensureSchema };
