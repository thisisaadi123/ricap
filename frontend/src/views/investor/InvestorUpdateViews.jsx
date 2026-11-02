// Investor portal (PRD 6.14): updates from RIV, account statement, profile.
import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Megaphone } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, MUTED } from "../../brand.js";
import {
  Card, EmptyState, ErrorBanner, Field, PrimaryButton, Spinner, SuccessBanner, dateStr, inputStyle, useSuccessMessage,
} from "../../components/ui.jsx";
import { DocLink, Muted, Row } from "../../components/forms.jsx";
import { StatementView } from "../../components/StatementView.jsx";

export function InvestorUpdatesView({ openId }) {
  const [updates, setUpdates] = useState(null);
  const [expanded, setExpanded] = useState(openId || null);
  const [error, setError] = useState("");
  useEffect(() => { api.investorUpdates().then((r) => setUpdates(r.updates)).catch((e) => setError(e.message)); }, []);
  useEffect(() => { if (openId) setExpanded(openId); }, [openId]);
  // Opening an update records that it was read (delivery log, PRD 8.10).
  useEffect(() => {
    const u = updates?.find((x) => x.id === expanded);
    if (!u || u.first_read_at) return;
    api.investorReadUpdate(u.id).catch(() => {});
    setUpdates((list) => list.map((x) => (x.id === u.id ? { ...x, first_read_at: new Date().toISOString() } : x)));
  }, [expanded, updates]);

  if (!updates) return error ? <ErrorBanner text={error} /> : <Spinner />;
  if (!updates.length) return <EmptyState icon={Megaphone} title="No updates yet" text="Letters, statements and deal news from RIV appear here." />;
  return (
    <div>
      <ErrorBanner text={error} />
      {updates.map((u) => {
        const isOpen = expanded === u.id;
        return (
          <Card key={u.id} style={{ marginBottom: 10 }}>
            <button type="button" onClick={() => setExpanded(isOpen ? null : u.id)} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 14, textAlign: "left" }}>
              {isOpen ? <ChevronDown size={15} color={MUTED} /> : <ChevronRight size={15} color={MUTED} />}
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: u.first_read_at ? 600 : 700, color: BRAND.ink }}>{u.title}</span>
                <Muted>{u.type} · {u.vehicle_name} · {dateStr(u.published_at)}</Muted>
              </span>
              {!u.first_read_at && <span style={{ width: 8, height: 8, borderRadius: 999, background: BRAND.coral }} aria-label="Unread" />}
            </button>
            {isOpen && (
              <div style={{ padding: "0 14px 14px 39px" }}>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.65 }}>{u.body}</div>
                {u.attachments.map((d) => <div key={d.id} style={{ marginTop: 8 }}><DocLink doc={d} onError={setError} /></div>)}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function InvestorStatementView() {
  const load = useCallback((asOf) => api.investorStatement(asOf), []);
  return <StatementView load={load} />;
}

export function InvestorProfileView({ onSaved }) {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, showSuccess] = useSuccessMessage();
  const fill = (p) => { setProfile(p); setForm({ name: p.contact.name, phone: p.contact.phone || "", legal_name: p.legal_name, country: p.country || "" }); };
  useEffect(() => { api.investorProfile().then((r) => fill(r.profile)).catch((e) => setError(e.message)); }, []);
  if (!form) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const legalChanged = form.legal_name !== profile.legal_name || form.country !== (profile.country || "");

  async function save(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      const r = await api.investorSaveProfile(form);
      fill(r.profile);
      onSaved?.();
      showSuccess(r.kyc_reopened ? "Saved. Your KYC is open again for RIV to review: see the KYC page." : "Saved.");
    } catch (err) { setError(err.message); }
    setSaving(false);
  }
  return (
    <Card style={{ padding: 20, maxWidth: 640 }}>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <form onSubmit={save}>
        <Row>
          <Field label="Your name" required><input style={inputStyle} value={form.name} onChange={set("name")} required /></Field>
          <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={set("phone")} /></Field>
        </Row>
        <Field label="Email" hint="Contact RIV to change the email you sign in with."><input style={{ ...inputStyle, background: BRAND.cream }} value={profile.contact.email} disabled /></Field>
        <Row>
          <Field label={profile.kind === "Individual" ? "Legal name" : "Legal entity name"} required><input style={inputStyle} value={form.legal_name} onChange={set("legal_name")} required /></Field>
          <Field label="Country"><input style={inputStyle} value={form.country} onChange={set("country")} /></Field>
        </Row>
        {legalChanged && <div style={{ fontSize: 12.5, color: "#B8790A", marginBottom: 14, lineHeight: 1.6 }}>Changing legal details reopens your KYC, so RIV can review it again.</div>}
        <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</PrimaryButton>
      </form>
    </Card>
  );
}
