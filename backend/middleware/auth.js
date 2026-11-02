const jwt = require("jsonwebtoken");
const { pool } = require("../db.js");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret";
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production.");
}

// Sessions last one working day; investors hold KYC and money data, so this
// is shorter than RISE's 7 days.
const SESSION_TTL = "8h";

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company },
    JWT_SECRET,
    { expiresIn: SESSION_TTL }
  );
}

// Unlike RISE, the user row is re-read on every request, so suspending a
// user or changing their role takes effect immediately instead of when
// their token expires.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in." });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }

  try {
    const { rows } = await pool.query(
      "SELECT id, email, name, role, status, company, sessions_valid_from FROM users WHERE id = $1",
      [payload.id]
    );
    const user = rows[0];
    if (!user || user.status !== "active") {
      return res.status(401).json({ error: "This account is not active. Please contact RIV." });
    }
    // iat is in whole seconds, so compare whole seconds: a sign-in right after
    // a password reset still counts.
    if (user.sessions_valid_from && payload.iat < Math.floor(new Date(user.sessions_valid_from).getTime() / 1000)) {
      return res.status(401).json({ error: "Session expired. Please sign in again." });
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company };
    next();
  } catch (err) {
    next(err);
  }
}

// requireRole("admin") or requireRole("admin", "partner").
function requireRole(...roles) {
  return function (req, res, next) {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: "You don't have access to this." });
    }
    next();
  };
}

const requireAdmin = requireRole("admin");

module.exports = { requireAuth, requireRole, requireAdmin, signToken };
