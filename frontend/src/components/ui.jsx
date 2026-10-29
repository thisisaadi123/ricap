// Shared UI building blocks. Same look as RISE's components (buttons,
// cards, fields, banners, badges, modal), split out into their own file.
import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { BRAND, FONT, MUTED } from "../brand.js";

export function PrimaryButton({ children, onClick, disabled, style, icon: Icon, type = "button" }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
      fontFamily: FONT, fontWeight: 600, fontSize: 13.5, background: disabled ? "#E7B4B4" : BRAND.coral,
      color: "#fff", border: "none", borderRadius: 9, padding: "10px 18px",
      cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap", ...style,
    }}>
      {Icon && <Icon size={14} />} {children}
    </button>
  );
}

export function GhostButton({ children, onClick, style, icon: Icon, disabled, type = "button" }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
      fontFamily: FONT, fontWeight: 600, fontSize: 13, background: "#fff",
      color: disabled ? "#B7B2AE" : BRAND.ink, border: `1px solid ${BRAND.line}`, borderRadius: 9, padding: "9px 16px",
      cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap", ...style,
    }}>
      {Icon && <Icon size={14} />} {children}
    </button>
  );
}

export function LinkButton({ children, onClick, style }) {
  return (
    <button type="button" onClick={onClick} style={{
      background: "none", border: "none", padding: 0, cursor: "pointer",
      fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: BRAND.blue, ...style,
    }}>
      {children}
    </button>
  );
}

export function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ border: `1px solid ${BRAND.line}`, borderRadius: 14, background: "#fff", ...style }}>{children}</div>;
}

export function Field({ label, children, required, hint, style }) {
  return (
    <label style={{ display: "block", marginBottom: 16, ...style }}>
      <div style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: BRAND.ink, marginBottom: 6 }}>
        {label}{required && <span style={{ color: BRAND.coral }}> *</span>}
      </div>
      {children}
      {hint && <div style={{ fontFamily: FONT, fontSize: 11.5, color: MUTED, marginTop: 5 }}>{hint}</div>}
    </label>
  );
}

export const inputStyle = {
  width: "100%", fontFamily: FONT, fontSize: 13.5, padding: "10px 12px",
  borderRadius: 9, border: `1px solid ${BRAND.line}`, background: "#fff", color: BRAND.ink,
};

export function ErrorBanner({ text }) {
  if (!text) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 12, background: "#FBEAEA", border: "1px solid #F3C6C6", marginBottom: 16 }}>
      <AlertCircle size={15} color={BRAND.coralDark} style={{ flexShrink: 0 }} />
      <div style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink }}>{text}</div>
    </div>
  );
}

export function SuccessBanner({ text, children }) {
  if (!text && !children) return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 16px", borderRadius: 12, background: "#E6F4EA", border: "1px solid #BFE3C9", marginBottom: 16 }}>
      <CheckCircle2 size={15} color="#1E7A34" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink, minWidth: 0 }}>{text}{children}</div>
    </div>
  );
}

// Holds a success message and clears it after a few seconds.
export function useSuccessMessage() {
  const [message, setMessage] = useState("");
  function show(text) {
    setMessage(text);
    setTimeout(() => setMessage((m) => (m === text ? "" : m)), 4000);
  }
  return [message, show];
}

export function Spinner({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", padding: "60px 20px", fontFamily: FONT, fontSize: 13, color: MUTED }}>
      <Loader2 size={16} className="ricap-spin" /> {label || "Loading…"}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px", border: `1px dashed ${BRAND.line}`, borderRadius: 14, background: "#fff" }}>
      <div style={{ width: 48, height: 48, borderRadius: 14, background: BRAND.cream, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", border: `1px solid ${BRAND.line}` }}>
        <Icon size={20} color={BRAND.coral} />
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 15, color: BRAND.ink }}>{title}</div>
      <div style={{ fontFamily: FONT, fontSize: 12.5, color: MUTED, marginTop: 6, maxWidth: 380, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>{text}</div>
    </div>
  );
}

const DEFAULT_BADGE = { bg: "#F3F1EE", fg: "#8A857F" };
export function StatusBadge({ status, colors = {}, label }) {
  const c = colors[status] || DEFAULT_BADGE;
  return (
    <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 11, padding: "4px 10px", borderRadius: 999, background: c.bg, color: c.fg, whiteSpace: "nowrap" }}>
      {label || status}
    </span>
  );
}

export function Modal({ title, onClose, children, width = 480 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(39,37,37,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: width, maxHeight: "88vh", overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 17, color: BRAND.ink }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: MUTED }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Table shell shared by admin list views.
export function DataTable({ columns, children }) {
  return (
    <Card style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT, fontSize: 12.5, color: BRAND.ink }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} style={{ textAlign: "left", padding: "12px 14px", fontWeight: 600, fontSize: 11.5, color: MUTED, borderBottom: `1px solid ${BRAND.line}`, whiteSpace: "nowrap" }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </Card>
  );
}
export const cellStyle = { padding: "12px 14px", borderBottom: `1px solid ${BRAND.line}`, verticalAlign: "middle" };

export function dateStr(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
export function dateTimeStr(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
// USD only in v1 (MON-3).
export function usd(n) {
  if (n === null || n === undefined || n === "") return "—";
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
      * { box-sizing: border-box; }
      button:focus-visible { outline: 2px solid ${BRAND.coral}; outline-offset: 2px; }
      input:focus, select:focus, textarea:focus { outline: 2px solid ${BRAND.coral}; outline-offset: 0; }
      .ricap-spin { animation: ricap-spin 0.9s linear infinite; }
      @keyframes ricap-spin { to { transform: rotate(360deg); } }
      input[type=number]::-webkit-outer-spin-button,
      input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      input[type=number] { -moz-appearance: textfield; appearance: textfield; }
    `}</style>
  );
}

// Same fix as RISE: scrolling while a number input is focused would change
// its value, so blur it on any wheel event.
export function useDisableNumberInputScroll() {
  useEffect(() => {
    function handleWheel() {
      const el = document.activeElement;
      if (el && el.tagName === "INPUT" && el.type === "number") el.blur();
    }
    document.addEventListener("wheel", handleWheel, { passive: true });
    return () => document.removeEventListener("wheel", handleWheel);
  }, []);
}
