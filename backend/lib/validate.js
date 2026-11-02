// Input readers for request bodies. Each returns a clean value or throws a
// 400 HttpError with a message the user can act on.
const { httpError } = require("./http.js");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, label, { required = false, max = 2000 } = {}) {
  const v = value === undefined || value === null ? "" : String(value).trim();
  if (!v) {
    if (required) throw httpError(400, `${label} is required.`);
    return null;
  }
  if (v.length > max) throw httpError(400, `${label} is too long (max ${max} characters).`);
  return v;
}

function email(value, label = "Email", { required = false } = {}) {
  const v = text(value, label, { required, max: 254 });
  if (v === null) return null;
  const lower = v.toLowerCase();
  if (!EMAIL_RE.test(lower)) throw httpError(400, `${label} isn't a valid email address.`);
  return lower;
}

function oneOf(value, list, label, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw httpError(400, `${label} is required.`);
    return null;
  }
  if (!list.includes(value)) throw httpError(400, `${label} must be one of: ${list.join(", ")}.`);
  return value;
}

function manyOf(value, list, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw httpError(400, `${label} must be a list.`);
  for (const v of value) if (!list.includes(v)) throw httpError(400, `${label}: "${v}" isn't allowed.`);
  return [...new Set(value)];
}

function textList(value, label, { max = 20 } = {}) {
  if (value === undefined || value === null || value === "") return [];
  const arr = Array.isArray(value) ? value : String(value).split(",");
  const clean = [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
  if (clean.length > max) throw httpError(400, `${label}: at most ${max} entries.`);
  return clean;
}

function number(value, label, { required = false, min = -Infinity, max = Infinity, integer = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw httpError(400, `${label} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) throw httpError(400, `${label} must be a ${integer ? "whole " : ""}number.`);
  if (n < min || n > max) throw httpError(400, `${label} must be between ${min} and ${max}.`);
  return n;
}

function date(value, label, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw httpError(400, `${label} is required.`);
    return null;
  }
  // The round trip catches impossible dates such as 2026-02-31.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== String(value)) {
    throw httpError(400, `${label} must be a real date (YYYY-MM-DD).`);
  }
  return String(value);
}

function bool(value) {
  return value === true || value === "true";
}

function id(value, label = "id") {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw httpError(400, `Invalid ${label}.`);
  return n;
}

module.exports = { text, email, oneOf, manyOf, textList, number, date, bool, id };
