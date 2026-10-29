// One-time Bigin import (PRD 10, INV-2): choose a CSV export, preview what
// happens to every row, then import.
import React, { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, MUTED } from "../../brand.js";
import {
  Card, DataTable, ErrorBanner, Field, GhostButton, PrimaryButton, StatusBadge, SuccessBanner, cellStyle, dateTimeStr, inputStyle,
} from "../../components/ui.jsx";
import { Muted, Row, SectionTitle, Select } from "../../components/forms.jsx";

const ACTION_COLORS = {
  create: { bg: "#E6F4EA", fg: "#1E7A34" },
  skip: { bg: "#F3F1EE", fg: "#8A857F" },
  error: { bg: "#FBEAEA", fg: "#D33639" },
};
const ACTION_LABELS = { create: "Will import", skip: "Skip", error: "Problem" };

export function AdminImportView() {
  const [kind, setKind] = useState("investors");
  const [file, setFile] = useState(null);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  const loadHistory = () => api.importHistory().then((r) => setHistory(r.imports)).catch(() => {});
  useEffect(() => { loadHistory(); }, []);

  async function choose(f) {
    setFile(f); setPreview(null); setDone(""); setError("");
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) return setError("That file is over 4 MB. Split it into smaller files.");
    const text = await f.text();
    setCsv(text);
    setBusy(true);
    try { setPreview(await api.previewImport(kind, text, f.name)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function run() {
    setBusy(true); setError("");
    try {
      const { summary } = await api.runImport(kind, csv, file.name);
      setDone(`Imported ${summary.create} ${kind}. Skipped ${summary.skip + summary.error}.`);
      setPreview(null); setFile(null); setCsv("");
      loadHistory();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14, lineHeight: 1.6 }}>
          Export the investor pipeline or the prospective partner list from Bigin as CSV. Imported investors join as approved, RIV-direct (no partner credit). Imported partners start at onboarding stage New. Rows already in RICap (same Bigin record id, email or name) are skipped, so re-importing is safe.
        </div>
        <Row>
          <Field label="What's in the file"><Select value={kind} onChange={(v) => { setKind(v); setPreview(null); setFile(null); }} options={[{ value: "investors", label: "Investor pipeline" }, { value: "partners", label: "Prospective venture partners" }]} /></Field>
          <Field label="CSV file"><input key={kind} type="file" accept=".csv,text/csv" style={inputStyle} onChange={(e) => choose(e.target.files?.[0] || null)} /></Field>
        </Row>
      </Card>
      <ErrorBanner text={error} />
      <SuccessBanner text={done} />
      {busy && !preview && <Muted>Reading the file…</Muted>}
      {preview && (
        <>
          <Card style={{ padding: 16, marginBottom: 14, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <div><strong>{preview.summary.total}</strong> rows</div>
            <div style={{ color: "#1E7A34" }}><strong>{preview.summary.create}</strong> to import</div>
            <div style={{ color: MUTED }}><strong>{preview.summary.skip}</strong> already in RICap</div>
            <div style={{ color: BRAND.coralDark }}><strong>{preview.summary.error}</strong> with problems</div>
            <PrimaryButton icon={Upload} style={{ marginLeft: "auto" }} disabled={busy || !preview.summary.create} onClick={run}>{busy ? "Importing…" : `Import ${preview.summary.create}`}</PrimaryButton>
          </Card>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>
            Columns recognised: {Object.entries(preview.recognised).filter(([, h]) => h).map(([f, h]) => `${h} → ${f.replace("_", " ")}`).join(", ") || "none"}.
            {" "}Unrecognised columns are ignored.
          </div>
          <DataTable columns={["Line", "What happens", kind === "investors" ? "Investor" : "Partner", "Details"]}>
            {preview.rows.map((r) => (
              <tr key={r.line}>
                <td style={cellStyle}>{r.line}</td>
                <td style={cellStyle}><StatusBadge status={r.action} colors={ACTION_COLORS} label={ACTION_LABELS[r.action]} />{r.issue && <div><Muted>{r.issue}</Muted></div>}</td>
                {kind === "investors" ? (
                  <>
                    <td style={cellStyle}><div style={{ fontWeight: 600 }}>{r.investor.legal_name || "—"}</div><Muted>{r.investor.kind} · {r.investor.category}</Muted></td>
                    <td style={cellStyle}>{[r.contact.name, r.contact.email, r.investor.country].filter(Boolean).join(" · ")}</td>
                  </>
                ) : (
                  <>
                    <td style={cellStyle}><div style={{ fontWeight: 600 }}>{r.partner.full_name || "—"}</div><Muted>{r.partner.company}</Muted></td>
                    <td style={cellStyle}>{[r.partner.email, r.partner.regions.join(", ")].filter(Boolean).join(" · ")}</td>
                  </>
                )}
              </tr>
            ))}
          </DataTable>
        </>
      )}
      {history.length > 0 && (
        <>
          <SectionTitle>Past imports</SectionTitle>
          <DataTable columns={["When", "Type", "File", "Imported", "Skipped", "By"]}>
            {history.map((h) => (
              <tr key={h.id}>
                <td style={cellStyle}>{dateTimeStr(h.created_at)}</td>
                <td style={cellStyle}>{h.kind}</td>
                <td style={cellStyle}>{h.filename || "—"}</td>
                <td style={cellStyle}>{h.created_count}</td>
                <td style={cellStyle}>{h.skipped_count}</td>
                <td style={cellStyle}>{h.imported_by_name}</td>
              </tr>
            ))}
          </DataTable>
        </>
      )}
    </div>
  );
}
