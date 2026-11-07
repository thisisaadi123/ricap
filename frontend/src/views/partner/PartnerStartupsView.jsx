// Venture partner: introduce startups to RIV and follow their status.
// Partners see only the startups they introduced, with a simplified status.
import React, { useCallback, useEffect, useState } from "react";
import { Plus, Rocket } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, MUTED } from "../../brand.js";
import { FUNDRAISING, STARTUP_SECTORS, STARTUP_STAGES, VP_STARTUP_STATUSES, VP_STATUS_COLORS, YES_NO } from "../../constants.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateStr, inputStyle, useSuccessMessage,
} from "../../components/ui.jsx";
import { Muted, Row, SectionTitle, Select } from "../../components/forms.jsx";

const EMPTY = {
  startup_name: "", website: "", linkedin_url: "", founder_name: "", founder_email: "", description: "", problem_solved: "", why_referring: "",
  startup_stage: "", sector: "", fundraising: "", personally_interacted: "", interested_in_rise_gtm: "", data_consent: false,
};

function IntroduceStartupModal({ onClose, onDone }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const input = (k, props = {}) => <input style={inputStyle} value={form[k]} onChange={(e) => set(k)(e.target.value)} {...props} />;
  const area = (k, props = {}) => <textarea style={{ ...inputStyle, minHeight: 70 }} maxLength={2000} value={form[k]} onChange={(e) => set(k)(e.target.value)} {...props} />;

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.data_consent) return setError("Confirm that the founder agreed to be introduced to RIV.");
    setSaving(true);
    try {
      await api.partnerAddStartup(form);
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Introduce a startup" onClose={onClose} width={680}>
      <form onSubmit={submit}>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 16, lineHeight: 1.6 }}>
          RIV reviews every introduction. Once accepted, the startup is credited to you for your credit window.
        </div>
        <ErrorBanner text={error} />
        <Row>
          <Field label="Startup name" required>{input("startup_name", { required: true, maxLength: 120 })}</Field>
          <Field label="Website" required>{input("website", { required: true, placeholder: "example.com" })}</Field>
        </Row>
        <Row>
          <Field label="Founder name" required>{input("founder_name", { required: true, maxLength: 255 })}</Field>
          <Field label="Founder email" required>{input("founder_email", { required: true, type: "email" })}</Field>
        </Row>
        <Field label="Startup description" required hint="What the startup does.">{area("description", { required: true })}</Field>
        <Field label="Why are you referring this startup to RIV?" required>{area("why_referring", { required: true })}</Field>
        <Field label="Problem being solved">{area("problem_solved")}</Field>
        <Row>
          <Field label="LinkedIn URL">{input("linkedin_url", { placeholder: "linkedin.com/company/…" })}</Field>
          <Field label="Sector"><Select value={form.sector} onChange={set("sector")} options={STARTUP_SECTORS} placeholder="Select…" /></Field>
        </Row>
        <Row>
          <Field label="Startup stage"><Select value={form.startup_stage} onChange={set("startup_stage")} options={STARTUP_STAGES} placeholder="Select…" /></Field>
          <Field label="Currently fundraising?"><Select value={form.fundraising} onChange={set("fundraising")} options={FUNDRAISING} placeholder="—" /></Field>
        </Row>
        <Row>
          <Field label="You have met or spoken with the founder"><Select value={form.personally_interacted} onChange={set("personally_interacted")} options={YES_NO} placeholder="—" /></Field>
          <Field label="Interested in RISE GTM support?"><Select value={form.interested_in_rise_gtm} onChange={set("interested_in_rise_gtm")} options={YES_NO} placeholder="—" /></Field>
        </Row>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5, margin: "6px 0 16px" }}>
          <input type="checkbox" style={{ marginTop: 3 }} checked={form.data_consent} onChange={(e) => set("data_consent")(e.target.checked)} />
          <span>The founder has agreed to be introduced to RIV. <strong style={{ color: BRAND.coralDark }}>*</strong></span>
        </label>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving}>{saving ? "Sending…" : "Send to RIV"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

export function PartnerStartupsView() {
  const [startups, setStartups] = useState(null);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [success, showSuccess] = useSuccessMessage();

  const load = useCallback(() => {
    api.partnerStartups().then((r) => setStartups(r.startups)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const count = (status) => (startups || []).filter((s) => s.vp_status === status).length;

  return (
    <div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(150px, 100%), 1fr))", gap: 14, marginBottom: 18 }}>
        <Card style={{ padding: 16 }}><Muted>Introduced</Muted><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{startups ? startups.length : "–"}</div></Card>
        {["Submitted", "Under review", "Accepted", "Live"].map((st) => (
          <Card key={st} style={{ padding: 16 }}><Muted>{st}</Muted><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{startups ? count(st) : "–"}</div></Card>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>Introduce startup</PrimaryButton>
      </div>
      {!startups ? <Spinner /> : !startups.length ? (
        <EmptyState icon={Rocket} title="No startups yet" text="Introduce startups from your network. RIV reviews each one and keeps you posted here." />
      ) : (
        <DataTable columns={["Startup", "Sector", "Founder", "Submitted", "Status", "Credit until"]}>
          {startups.map((s) => (
            <tr key={s.id}>
              <td style={cellStyle}>
                <div style={{ fontWeight: 600 }}>{s.startup_name}</div>
                <Muted>{s.website.replace(/^https?:\/\//, "")}</Muted>
              </td>
              <td style={cellStyle}>{s.sector || "—"}</td>
              <td style={cellStyle}>{s.founder_name}</td>
              <td style={cellStyle}>{dateStr(s.created_at)}</td>
              <td style={cellStyle}>
                <StatusBadge status={s.vp_status} colors={VP_STATUS_COLORS} />
                {s.rejection_reason && <div><Muted>{s.rejection_reason}</Muted></div>}
              </td>
              <td style={cellStyle}>{s.credit_expires_at ? dateStr(s.credit_expires_at) : <Muted>—</Muted>}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <SectionTitle>What the statuses mean</SectionTitle>
      <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.8 }}>
        {VP_STARTUP_STATUSES.map((st) => (
          <div key={st}><StatusBadge status={st} colors={VP_STATUS_COLORS} /> <span style={{ marginLeft: 6 }}>{{
            Submitted: "Waiting for RIV's review.",
            "Under review": "RIV has opened it.",
            Accepted: "RIV accepted the startup. The deal is not yet live.",
            Live: "The deal is live for investors.",
            Closed: "The deal has closed.",
            "Not accepted": "RIV did not take this one forward.",
          }[st]}</span></div>
        ))}
      </div>
      {showAdd && <IntroduceStartupModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); showSuccess("Sent to RIV for review."); load(); }} />}
    </div>
  );
}
