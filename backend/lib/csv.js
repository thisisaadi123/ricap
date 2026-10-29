// Minimal RFC 4180 CSV parser for Bigin exports: quoted fields, escaped
// quotes (""), commas and newlines inside quotes, CRLF line endings and a
// leading byte-order mark. Returns { headers, rows } where each row is an
// object keyed by header.

function parseCsv(input) {
  const s = String(input || "").replace(/^﻿/, "");
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      record.push(field); field = "";
      records.push(record); record = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length) { record.push(field); records.push(record); }

  const nonEmpty = records.filter((r) => r.some((f) => f.trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, rows };
}

module.exports = { parseCsv };
