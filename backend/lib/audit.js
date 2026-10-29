// Audit log writer (PRD 8.13). Pass a pg client when the change runs in a
// transaction, so the audit row commits or rolls back with it.
const { pool } = require("../db.js");

function clientIp(req) {
  return req?.ip || req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || null;
}

async function logAudit({ actorId = null, action, objectType = null, objectId = null, details = {}, req = null }, db = pool) {
  await db.query(
    `INSERT INTO audit_log (actor_user_id, action, object_type, object_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, action, objectType, objectId === null ? null : String(objectId), details, clientIp(req)]
  );
}

module.exports = { logAudit };
