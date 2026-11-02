const express = require("express");
const path = require("path");

const { runMigrations } = require("./db.js");
const authRoutes = require("./routes/auth.js");
const adminRoutes = require("./routes/admin.js");
const partnerRoutes = require("./routes/partners.js");
const investorRoutes = require("./routes/investors.js");
const importRoutes = require("./routes/imports.js");
const kycRoutes = require("./routes/kyc.js");
const templateRoutes = require("./routes/templates.js");
const documentRoutes = require("./routes/documents.js");
const partnerPortalRoutes = require("./routes/partnerPortal.js");
const investorPortalRoutes = require("./routes/investorPortal.js");
const vehicleRoutes = require("./routes/vehicles.js");
const commitmentRoutes = require("./routes/commitments.js");
const dealRoutes = require("./routes/deals.js");
const moneyRoutes = require("./routes/money.js");
const updateRoutes = require("./routes/updates.js");
const dashboardRoutes = require("./routes/dashboards.js");
const notificationRoutes = require("./routes/notifications.js");
const { flushEmailsAfterWrites } = require("./lib/notify.js");

const app = express();
app.disable("x-powered-by");
// Netlify sits one hop in front of Express and appends the real client IP
// to X-Forwarded-For. Trusting exactly one hop makes req.ip that value
// (used by rate limits and the audit log) without letting a client spoof it
// by sending its own X-Forwarded-For.
app.set("trust proxy", 1);

// 1 MB JSON bodies everywhere except the Bigin import, which parses its own
// larger body (CSV text) in routes/imports.js. File uploads are multipart
// and handled by multer per route.
const json = express.json({ limit: "1mb" });
app.use((req, res, next) => (req.path.startsWith("/api/admin/import") ? next() : json(req, res, next)));

// The frontend is served from the same origin in dev (Vite proxy) and in
// production (Netlify redirect), so no CORS is needed. Keep it that way:
// leaving CORS off means other sites can't call this API from a browser.

app.use(flushEmailsAfterWrites);

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/admin/partners", partnerRoutes);
app.use("/api/admin/investors", investorRoutes);
app.use("/api/admin/import", importRoutes);
app.use("/api/admin/kyc", kycRoutes);
app.use("/api/admin/templates", templateRoutes);
app.use("/api/admin/vehicles", vehicleRoutes.router);
app.use("/api/admin/commitments", commitmentRoutes);
app.use("/api/admin/deals", dealRoutes);
app.use("/api/admin/money", moneyRoutes);
app.use("/api/admin/updates", updateRoutes);
app.use("/api/admin/dashboard", dashboardRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin/documents", documentRoutes.adminRouter);
app.use("/api/admin", adminRoutes);
app.use("/api/documents", documentRoutes.linkRouter);
app.use("/api/files", documentRoutes.fileRouter);
app.use("/api/partner", partnerPortalRoutes);
app.use("/api/investor", investorPortalRoutes);
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

const frontendDist = path.join(__dirname, "../frontend/dist");
app.use(express.static(frontendDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "That request is too large." });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.status === 503) return res.status(503).json({ error: err.message });
  // Postgres constraint violations reaching here are input problems the
  // route didn't catch; report them as 400 rather than a server error.
  if (err.code === "23505") return res.status(409).json({ error: "That would create a duplicate record." });
  if (err.code === "23514" || err.code === "23502") return res.status(400).json({ error: "Some of the values aren't allowed." });
  if (err.code === "22003") return res.status(400).json({ error: "That number is too large." });
  if (["22P02", "22007", "22008"].includes(err.code)) return res.status(400).json({ error: "Some of the values aren't valid." });
  if (err.code === "23503") return res.status(400).json({ error: "That refers to a record that doesn't exist." });
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
