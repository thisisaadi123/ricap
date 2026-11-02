// Venture partners: onboarding entirely in RICap (PRD 6.1, VP-5).
import React, { useCallback, useEffect, useState } from "react";
import { Handshake, Mail, Plus } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, MUTED } from "../../brand.js";
import { PARTNER_NETWORK_TYPES, PARTNER_STAGES, PARTNER_STAGE_COLORS, PARTNER_TIERS, REGISTRATION_COLORS } from "../../constants.js";
import {
  DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateStr, inputStyle, useSuccessMessage,
} from "../../components/ui.jsx";
import { CheckboxChips, Muted, Row, SectionTitle, Select, Tabs } from "../../components/forms.jsx";
import { DocumentsPanel } from "../../components/DocumentsPanel.jsx";
import { InviteLinkNotice } from "./AdminUsersView.jsx";

const EMPTY = {
  full_name: "", email: "", company: "", phone: "", linkedin_url: "", regions: "", sectors: "", tier: "",
  investor_reach_count: "", investor_network_types: [], retail_network: "", profile_summary: "",
  onboarding_stage: "New", agreement_link: "", agreement_signed_date: "",
  payout_holdco_pct: 4, payout_fund_pct: 4, payout_ib_pct: 15, payout_vat_pct: 5, credit_window_months: 12, status: "Active", notes: "",
};

function toForm(p) {
  const f = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) if (p[k] !== null && p[k] !== undefined) f[k] = p[k];
  f.regions = (p.regions || []).join(", ");
  f.sectors = (p.sectors || []).join(", ");
  f.agreement_signed_date = p.agreement_signed_date ? String(p.agreement_signed_date).slice(0, 10) : "";
  return f;
}

function PartnerForm({ form, setForm }) {
  const set = (k) => (val) => setForm((f) => ({ ...f, [k]: val }));
  const input = (k, props = {}) => <input style={inputStyle} value={form[k] ?? ""} onChange={(e) => set(k)(e.target.value)} {...props} />;
  return (
    <>
      <Row>
        <Field label="Full name" required>{input("full_name", { required: true })}</Field>
        <Field label="Email" required hint="Used for their login.">{input("email", { type: "email", required: true })}</Field>
      </Row>
      <Row>
        <Field label="Company / firm">{input("company")}</Field>
        <Field label="Phone">{input("phone")}</Field>
      </Row>
      <Row>
        <Field label="LinkedIn">{input("linkedin_url")}</Field>
        <Field label="Tier"><Select value={form.tier} onChange={set("tier")} options={PARTNER_TIERS} placeholder="—" /></Field>
      </Row>
      <Row>
        <Field label="Regions" hint="Comma separated, e.g. UAE, KSA, India.">{input("regions")}</Field>
        <Field label="Sectors" hint="Retail sectors they cover, comma separated.">{input("sectors")}</Field>
      </Row>
      <Row>
        <Field label="Investors they can reach" hint="Roughly how many.">{input("investor_reach_count", { type: "number", min: 0 })}</Field>
        <Field label="Status"><Select value={form.status} onChange={set("status")} options={["Active", "Inactive"]} /></Field>
      </Row>
      <Field label="Investor network"><CheckboxChips options={PARTNER_NETWORK_TYPES} value={form.investor_network_types} onChange={set("investor_network_types")} /></Field>
      <Field label="Retail network" hint="Retailers, retail groups and retail-focused investors they can reach.">
        <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.retail_network ?? ""} onChange={(e) => set("retail_network")(e.target.value)} />
      </Field>
      <Field label="Profile summary">
        <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.profile_summary ?? ""} onChange={(e) => set("profile_summary")(e.target.value)} />
      </Field>

      <SectionTitle>Agreement and payout terms</SectionTitle>
      <Row>
        <Field label="Onboarding stage"><Select value={form.onboarding_stage} onChange={set("onboarding_stage")} options={PARTNER_STAGES} /></Field>
        <Field label="Agreement signed on" hint="Needed for Signed / Onboarded.">{input("agreement_signed_date", { type: "date" })}</Field>
      </Row>
      <Field label="Agreement link" hint="Zoho Sign link or reference, until Zoho Sign is connected.">{input("agreement_link")}</Field>
      <Row>
        <Field label="HoldCo payout %" hint="Of capital raised.">{input("payout_holdco_pct", { type: "number", step: "0.01", min: 0, max: 100 })}</Field>
        <Field label="Fund payout %" hint="Of capital raised.">{input("payout_fund_pct", { type: "number", step: "0.01", min: 0, max: 100 })}</Field>
        <Field label="IB payout %" hint="Of RIV's total IB fee.">{input("payout_ib_pct", { type: "number", step: "0.01", min: 0, max: 100 })}</Field>
        <Field label="VAT on payouts %" hint="0 if not VAT-registered.">{input("payout_vat_pct", { type: "number", step: "0.01", min: 0, max: 100 })}</Field>
        <Field label="Credit window" hint="Months.">{input("credit_window_months", { type: "number", min: 0, max: 120 })}</Field>
      </Row>
      <Field label="Internal notes"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.notes ?? ""} onChange={(e) => set("notes")(e.target.value)} /></Field>
    </>
  );
}

function payload(form) {
  return {
    ...form,
    regions: form.regions, sectors: form.sectors,
    tier: form.tier || null,
    agreement_signed_date: form.agreement_signed_date || null,
    investor_reach_count: form.investor_reach_count === "" ? null : form.investor_reach_count,
  };
}

function AddPartnerModal({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      const { partner } = await api.createPartner(payload(form));
      onCreated(partner);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }
  return (
    <Modal title="Add venture partner" onClose={onClose} width={720}>
      <form onSubmit={submit}>
        <ErrorBanner text={error} />
        <PartnerForm form={form} setForm={setForm} />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Add partner"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function PartnerDetailModal({ partnerId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState("profile");
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [inviteLink, setInviteLink] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.getPartner(partnerId).then((r) => { setData(r); setForm(toForm(r.partner)); }).catch((e) => setError(e.message));
  }, [partnerId]);
  useEffect(load, [load]);

  async function save(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      await api.updatePartner(partnerId, payload(form));
      showSuccess("Partner saved.");
      load(); onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function invite() {
    setError(""); setInviteLink("");
    try {
      const r = await api.invitePartner(partnerId);
      setInviteLink(r.inviteLink || "");
      if (r.emailSent) showSuccess("Login invite emailed.");
      load(); onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!data) return <Modal title="Venture partner" onClose={onClose} width={760}>{error ? <ErrorBanner text={error} /> : <Spinner />}</Modal>;
  const p = data.partner;
  const loginLabel = !p.user_id ? "No login yet" : p.login_status === "active" ? "Login active" : p.login_status === "invited" ? "Invite sent, not accepted" : "Login suspended";

  return (
    <Modal title={p.full_name} onClose={onClose} width={760}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <StatusBadge status={p.onboarding_stage} colors={PARTNER_STAGE_COLORS} />
        <Muted>{loginLabel}</Muted>
        <div style={{ marginLeft: "auto" }}>
          {(!p.user_id || p.login_status === "invited") && (
            <GhostButton icon={Mail} onClick={invite} disabled={p.onboarding_stage !== "Onboarded"}>
              {p.user_id ? "Resend login invite" : "Send login invite"}
            </GhostButton>
          )}
        </div>
      </div>
      {p.onboarding_stage !== "Onboarded" && !p.user_id && <div style={{ fontSize: 12, color: MUTED, marginBottom: 12 }}>The login invite unlocks once the partner is Onboarded (agreement signed).</div>}
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <InviteLinkNotice link={inviteLink} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "profile", label: "Profile & terms" },
        { id: "investors", label: "Investors", count: data.investors.length },
        { id: "documents", label: "Documents" },
      ]} />
      {tab === "profile" && (
        <form onSubmit={save}>
          <PartnerForm form={form} setForm={setForm} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</PrimaryButton>
          </div>
        </form>
      )}
      {tab === "investors" && (data.investors.length ? (
        <DataTable columns={["Investor", "Category", "Status", "Credit until"]}>
          {data.investors.map((i) => (
            <tr key={i.id}>
              <td style={cellStyle}>{i.legal_name}{i.company && i.company !== i.legal_name && <div><Muted>{i.company}</Muted></div>}</td>
              <td style={cellStyle}>{i.category}</td>
              <td style={cellStyle}><StatusBadge status={i.registration_status} colors={REGISTRATION_COLORS} /></td>
              <td style={cellStyle}>{dateStr(i.credit_expires_at)}</td>
            </tr>
          ))}
        </DataTable>
      ) : <EmptyState icon={Handshake} title="No investors yet" text="Investors this partner registers will appear here." />)}
      {tab === "documents" && <DocumentsPanel linkedType="partner" linkedId={p.id} />}
    </Modal>
  );
}

export function AdminPartnersView() {
  const [partners, setPartners] = useState(null);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [stage, setStage] = useState("all");

  const load = useCallback(() => {
    api.listPartners().then((r) => setPartners(r.partners)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const shown = (partners || []).filter((p) => stage === "all" || p.onboarding_stage === stage);
  const count = (s) => (partners || []).filter((p) => p.onboarding_stage === s).length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>Add partner</PrimaryButton>
      </div>
      <ErrorBanner text={error} />
      <Tabs value={stage} onChange={setStage} tabs={[{ id: "all", label: "All", count: partners?.length }, ...PARTNER_STAGES.map((s) => ({ id: s, label: s, count: count(s) }))]} />
      {!partners ? <Spinner /> : !shown.length ? (
        <EmptyState icon={Handshake} title="No venture partners here" text="Add a partner, or import prospective partners from Bigin." />
      ) : (
        <DataTable columns={["Partner", "Regions", "Tier", "Stage", "Investors", "Login"]}>
          {shown.map((p) => (
            <tr key={p.id} onClick={() => setOpenId(p.id)} style={{ cursor: "pointer" }}>
              <td style={cellStyle}>
                <div style={{ fontWeight: 600, color: BRAND.ink }}>{p.full_name}</div>
                <Muted>{[p.company, p.email].filter(Boolean).join(" · ")}</Muted>
              </td>
              <td style={cellStyle}>{p.regions?.join(", ") || "—"}</td>
              <td style={cellStyle}>{p.tier || "—"}</td>
              <td style={cellStyle}><StatusBadge status={p.onboarding_stage} colors={PARTNER_STAGE_COLORS} />{p.status === "Inactive" && <div><Muted>Inactive</Muted></div>}</td>
              <td style={cellStyle}>{p.approved_investor_count} approved{p.investor_count > p.approved_investor_count && <div><Muted>{p.investor_count - p.approved_investor_count} other</Muted></div>}</td>
              <td style={cellStyle}>{!p.user_id ? <Muted>None</Muted> : p.login_status === "active" ? "Active" : p.login_status === "invited" ? <Muted>Invited</Muted> : "Suspended"}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {showAdd && <AddPartnerModal onClose={() => setShowAdd(false)} onCreated={(p) => { setShowAdd(false); load(); setOpenId(p.id); }} />}
      {openId && <PartnerDetailModal partnerId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
