// File storage for documents (KYC uploads, signed agreements, templates).
//
// Two drivers behind one interface:
//   - "s3": Supabase Storage through its S3-compatible API, exactly as RISE
//     does (see RISE's supportingMaterialStorage.js for why the S3 API and
//     not the Supabase JS client). Used automatically once the four
//     SUPABASE_S3_* variables are set.
//   - "local": a folder on disk (backend/storage by default). For local
//     development only; serverless hosting has no lasting disk.
//
// Every download goes through a link that expires after 60 seconds
// (PRD 9.2): a presigned URL for s3, or an HMAC-signed /api/files/ token
// for local.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LINK_TTL_SECONDS = 60;
const SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret";

function s3Configured() {
  const e = process.env;
  return Boolean(e.SUPABASE_S3_ENDPOINT && e.SUPABASE_S3_REGION && e.SUPABASE_S3_ACCESS_KEY_ID && e.SUPABASE_S3_SECRET_ACCESS_KEY);
}

function driverName() {
  return process.env.STORAGE_DRIVER || (s3Configured() ? "s3" : "local");
}

// ---------- local driver ----------
function localDir() {
  return process.env.LOCAL_STORAGE_DIR || path.join(__dirname, "..", "storage");
}

function localPath(key) {
  const base = path.resolve(localDir());
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) throw new Error("Invalid storage key.");
  return full;
}

function sign(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

// Token for /api/files/:token. Carries the key, download filename and
// expiry; the HMAC stops anyone forging or extending it.
function makeFileToken(key, filename) {
  const payload = Buffer.from(JSON.stringify({ k: key, n: filename, e: Date.now() + LINK_TTL_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readFileToken(token) {
  const [payload, mac] = String(token || "").split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (Date.now() > data.e) return null;
  return { key: data.k, filename: data.n };
}

// ---------- s3 driver ----------
let s3 = null;
function s3Client() {
  if (s3) return s3;
  const { S3Client } = require("@aws-sdk/client-s3");
  const e = process.env;
  s3 = new S3Client({
    endpoint: e.SUPABASE_S3_ENDPOINT,
    region: e.SUPABASE_S3_REGION,
    credentials: { accessKeyId: e.SUPABASE_S3_ACCESS_KEY_ID, secretAccessKey: e.SUPABASE_S3_SECRET_ACCESS_KEY },
    forcePathStyle: true,
  });
  return s3;
}
function bucket() {
  return process.env.SUPABASE_DOCUMENTS_BUCKET || "ricap-documents";
}

// ---------- interface ----------
async function putFile(key, buffer, mimeType) {
  if (driverName() === "s3") {
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    await s3Client().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: buffer, ContentType: mimeType }));
    return;
  }
  const full = localPath(key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, buffer, { flag: "wx" });
}

async function deleteFile(key) {
  if (driverName() === "s3") {
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    await s3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })).catch(() => {});
    return;
  }
  await fs.promises.unlink(localPath(key)).catch(() => {});
}

// Returns a URL the browser can open for the next 60 seconds.
async function downloadUrl(key, filename) {
  if (driverName() === "s3") {
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
    const disposition = `attachment; filename="${filename.replace(/["\\\r\n]/g, "_")}"`;
    return getSignedUrl(s3Client(), new GetObjectCommand({ Bucket: bucket(), Key: key, ResponseContentDisposition: disposition }), { expiresIn: LINK_TTL_SECONDS });
  }
  return `/api/files/${makeFileToken(key, filename)}`;
}

module.exports = { putFile, deleteFile, downloadUrl, readFileToken, localPath, driverName };
