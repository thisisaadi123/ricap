// Venture partner: register investors and follow their status (PRD 6.2).
// Partners see only their own investors and never another partner's.
import React, { useCallback, useEffect, useState } from "react";
import { Plus, UserPlus } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, MUTED } from "../../brand.js";
import {
  CONTACT_ROLES, DESTINATIONS, EXPECTED_SUPPORT, INTRO_METHODS, INVESTOR_CATEGORIES, INVESTOR_KINDS, KYC_COLORS, RELATIONSHIP_TYPES,
  VP_STATUS_COLORS, YES_NO,
} from "../../constants.js";
import { COUNTRIES } from "../../countries.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateStr, inputStyle, usd, useSuccessMessage,
} from "../../components/ui.jsx";
import { CheckboxChips, Muted, Row, SectionTitle, Select } from "../../components/forms.jsx";

const EMPTY = {
  kind: "Entity", legal_name: "", company: "", category: "Family office", country: "", ticket_min: "", ticket_max: "", destinations: [],
  relationship_note: "", relationship_type: "", linkedin_url: "", previously_invested: "", personally_interacted: "", informed_about_riv: "",
  intro_methods: [], expected_support: "", data_consent: false,
};
const EMPTY_CONTACT = { name: "", email: "", phone: "", role: "Decision-maker" };

function AddInvestorModal({ onClose, onDone }) {
  const [form, setForm] = useState(EMPTY);
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const input = (k, props = {}) => <input style={inputStyle} value={form[k]} onChange={(e) => set(k)(e.target.value)} {...props} />;
  const setC = (k) => (e) => setContact((c) => ({ ...c, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.ticket_min && !form.ticket_max) return setError("Enter the indicative investment size (at least one figure).");
    if (!form.data_consent) return setError("Confirm that the investor agreed to be introduced to RIV.");
    setSaving(true);
    try {
      await api.partnerAddInvestor({ ...form, ticket_min: form.ticket_min || null, ticket_max: form.ticket_max || null, contact });
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Introduce an investor" onClose={onClose} width={680}>
      <form onSubmit={submit}>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 16, lineHeight: 1.6 }}>
          RIV reviews every introduction. Once approved, the investor is credited to you for your credit window.
        </div>
        <ErrorBanner text={error} />
        <Row>
          <Field label="Investor kind" required><Select value={form.kind} onChange={set("kind")} options={INVESTOR_KINDS} /></Field>
          <Field label="Category" required><Select value={form.category} onChange={set("category")} options={INVESTOR_CATEGORIES} /></Field>
        </Row>
        <Row>
          <Field label={form.kind === "Entity" ? "Legal entity name" : "Full name"} required>{input("legal_name", { required: true })}</Field>
          <Field label="Company / group">{input("company")}</Field>
        </Row>
        <Row>
          <Field label="Country"><Select value={form.country} onChange={set("country")} options={COUNTRIES} placeholder="Select a country" /></Field>
          <Field label="LinkedIn URL">{input("linkedin_url", { placeholder: "linkedin.com/in/…" })}</Field>
        </Row>
        <Row>
          <Field label="Indicative investment from (USD)" required hint="Enter at least one figure.">{input("ticket_min", { type: "number", min: 0 })}</Field>
          <Field label="Up to (USD)">{input("ticket_max", { type: "number", min: 0 })}</Field>
        </Row>
        <Field label="Interested in"><CheckboxChips options={DESTINATIONS} value={form.destinations} onChange={set("destinations")} /></Field>
        <Field label="Source" required hint="How you know the investor.">
          <Select value={form.relationship_type} onChange={set("relationship_type")} options={RELATIONSHIP_TYPES} placeholder="Select…" />
        </Field>
        <Field label="Why are you referring this investor?" required hint="A line or two for RIV.">
          <textarea style={{ ...inputStyle, minHeight: 70 }} maxLength={2000} required value={form.relationship_note} onChange={(e) => set("relationship_note")(e.target.value)} />
        </Field>
        <Row>
          <Field label="Previously invested in startups"><Select value={form.previously_invested} onChange={set("previously_invested")} options={YES_NO} placeholder="—" /></Field>
          <Field label="You have met or spoken with them"><Select value={form.personally_interacted} onChange={set("personally_interacted")} options={YES_NO} placeholder="—" /></Field>
          <Field label="They know about RIV"><Select value={form.informed_about_riv} onChange={set("informed_about_riv")} options={YES_NO} placeholder="—" /></Field>
        </Row>
        <Field label="How have you introduced them to RIV?"><CheckboxChips options={INTRO_METHODS} value={form.intro_methods} onChange={set("intro_methods")} /></Field>
        <Field label="How will you support this introduction?">
          <Select value={form.expected_support} onChange={set("expected_support")} options={EXPECTED_SUPPORT} placeholder="—" />
        </Field>
        <SectionTitle>Primary contact</SectionTitle>
        <Row>
          <Field label="Name" required><input style={inputStyle} value={contact.name} onChange={setC("name")} required /></Field>
          <Field label="Email" required><input style={inputStyle} type="email" value={contact.email} onChange={setC("email")} required /></Field>
        </Row>
        <Row>
          <Field label="Phone"><input style={inputStyle} value={contact.phone} onChange={setC("phone")} /></Field>
          <Field label="Role"><Select value={contact.role} onChange={(v) => setContact((c) => ({ ...c, role: v }))} options={CONTACT_ROLES} /></Field>
        </Row>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5, margin: "6px 0 16px" }}>
          <input type="checkbox" style={{ marginTop: 3 }} checked={form.data_consent} onChange={(e) => set("data_consent")(e.target.checked)} />
          <span>The investor has agreed to be introduced to RIV. <strong style={{ color: BRAND.coralDark }}>*</strong></span>
        </label>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving}>{saving ? "Sending…" : "Send to RIV"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

export function PartnerInvestorsView() {
  const [investors, setInvestors] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [success, showSuccess] = useSuccessMessage();

  const load = useCallback(() => {
    api.partnerInvestors().then((r) => setInvestors(r.investors)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); api.partnerMe().then((r) => setMe(r.partner)).catch(() => {}); }, [load]);

  const approved = (investors || []).filter((i) => i.registration_status === "Approved").length;
  const pending = (investors || []).filter((i) => i.registration_status === "Submitted").length;

  return (
    <div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))", gap: 14, marginBottom: 18 }}>
        <Card style={{ padding: 16 }}><Muted>Approved investors</Muted><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{investors ? approved : "–"}</div></Card>
        <Card style={{ padding: 16 }}><Muted>Waiting for RIV</Muted><div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{investors ? pending : "–"}</div></Card>
        {me && (
          <Card style={{ padding: 16 }}>
            <Muted>Your terms</Muted>
            <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
              {Number(me.payout_holdco_pct)}% HoldCo · {Number(me.payout_fund_pct)}% Fund · {Number(me.payout_ib_pct)}% of IB fee
              <div><Muted>Credit protected for {me.credit_window_months} months</Muted></div>
            </div>
          </Card>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>Introduce investor</PrimaryButton>
      </div>
      {!investors ? <Spinner /> : !investors.length ? (
        <EmptyState icon={UserPlus} title="No investors yet" text="Introduce investors from your network. RIV reviews each one and keeps you posted here." />
      ) : (
        <DataTable columns={["Investor", "Interested in", "Ticket", "Status", "KYC", "Credit until"]}>
          {investors.map((i) => (
            <tr key={i.id}>
              <td style={cellStyle}>
                <div style={{ fontWeight: 600 }}>{i.display_name || i.legal_name}</div>
                <Muted>{[i.category, i.primary_contact_name].filter(Boolean).join(" · ")}</Muted>
              </td>
              <td style={cellStyle}>{i.destinations?.join(", ") || "—"}</td>
              <td style={cellStyle}>{i.ticket_min || i.ticket_max ? `${usd(i.ticket_min)} – ${usd(i.ticket_max)}` : "—"}</td>
              <td style={cellStyle}>
                <StatusBadge status={i.vp_status} colors={VP_STATUS_COLORS} />
                {i.rejection_reason && <div><Muted>{i.rejection_reason}</Muted></div>}
              </td>
              <td style={cellStyle}>{i.kyc_status ? <StatusBadge status={i.kyc_status} colors={KYC_COLORS} /> : <Muted>—</Muted>}</td>
              <td style={cellStyle}>{dateStr(i.credit_expires_at)}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {showAdd && <AddInvestorModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); showSuccess("Sent to RIV for review."); load(); }} />}
    </div>
  );
}
