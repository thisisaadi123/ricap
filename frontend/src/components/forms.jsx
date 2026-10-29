// Form and layout helpers used by the M1/M2 screens, in the same style as
// ui.jsx.
import React, { useRef, useState } from "react";
import { Upload, FileText, ExternalLink } from "lucide-react";
import { openDocument } from "../api.js";
import { BRAND, FONT, MUTED } from "../brand.js";
import { GhostButton, inputStyle, StatusBadge, dateStr } from "./ui.jsx";
import { SIGNATURE_COLORS } from "../constants.js";

export function Select({ value, onChange, options, placeholder, style, disabled }) {
  return (
    <select style={{ ...inputStyle, ...style }} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === "string"
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

// Tick-box chips for multi-choice fields (destinations, network types).
export function CheckboxChips({ options, value = [], onChange }) {
  const toggle = (o) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" onClick={() => toggle(o)} style={{
            fontFamily: FONT, fontSize: 12.5, fontWeight: 600, padding: "7px 12px", borderRadius: 999, cursor: "pointer",
            border: `1px solid ${on ? BRAND.coral : BRAND.line}`, background: on ? "#FDECEC" : "#fff", color: on ? BRAND.coralDark : BRAND.ink,
          }}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${BRAND.line}`, marginBottom: 18, flexWrap: "wrap" }}>
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => onChange(t.id)} style={{
          fontFamily: FONT, fontWeight: 600, fontSize: 13, padding: "9px 12px", border: "none", background: "none", cursor: "pointer",
          color: value === t.id ? BRAND.coral : "#7A756F", borderBottom: `2px solid ${value === t.id ? BRAND.coral : "transparent"}`, marginBottom: -1,
        }}>
          {t.label}{t.count !== undefined ? ` (${t.count})` : ""}
        </button>
      ))}
    </div>
  );
}

// Two-column label/value grid for detail views.
export function KeyValues({ rows }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 200px) 1fr", gap: "10px 16px", fontFamily: FONT, fontSize: 13 }}>
      {rows.filter(Boolean).map(([k, v]) => (
        <React.Fragment key={k}>
          <div style={{ color: MUTED, fontWeight: 600, fontSize: 12.5 }}>{k}</div>
          <div style={{ color: BRAND.ink, wordBreak: "break-word" }}>{v === null || v === undefined || v === "" ? "—" : v}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

export function Row({ children, gap = 14 }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${React.Children.count(children)}, minmax(0, 1fr))`, gap }}>{children}</div>;
}

export function SectionTitle({ children, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "22px 0 10px" }}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>{children}</div>
      {action}
    </div>
  );
}

// "Upload" button that opens the file picker and hands the chosen file on.
export function FileButton({ onFile, label = "Upload", disabled, accept = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx", style }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={ref} type="file" accept={accept} style={{ display: "none" }} onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setBusy(true);
        try { await onFile(file); } finally { setBusy(false); }
      }} />
      <GhostButton icon={Upload} disabled={disabled || busy} onClick={() => ref.current?.click()} style={{ padding: "6px 10px", fontSize: 12, ...style }}>
        {busy ? "Uploading…" : label}
      </GhostButton>
    </>
  );
}

export function DocLink({ doc, onError }) {
  return (
    <button type="button" onClick={() => openDocument(doc.id).catch((e) => onError?.(e.message))} style={{
      display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer",
      fontFamily: FONT, fontSize: 12.5, color: BRAND.blue, fontWeight: 600, textAlign: "left",
    }}>
      <FileText size={13} /> {doc.filename} <ExternalLink size={11} />
    </button>
  );
}

export function SignatureBadge({ status }) {
  return <StatusBadge status={status} colors={SIGNATURE_COLORS} />;
}

export function Muted({ children, style }) {
  return <span style={{ color: MUTED, fontSize: 11.5, fontFamily: FONT, ...style }}>{children}</span>;
}

export function sizeStr(bytes) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function uploadedLine(d) {
  return `${dateStr(d.uploaded_at)}${d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ""}${d.source ? ` · ${d.source}` : ""}`;
}
