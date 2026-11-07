// Investors: partner submissions to review, RIV-direct investors, contacts
// and their portal logins, KYC status and documents (PRD 6.2, 6.3, 6.14).
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Mail, Plus, Search, Users } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import {
  ADMIN_INVESTOR_SOURCES, CONTACT_ROLES, DESTINATIONS, INCLINATIONS, INVESTOR_CATEGORIES, INVESTOR_KINDS,
  KYC_COLORS, REGISTRATION_COLORS,
} from "../../constants.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge,
  SuccessBanner, cellStyle, dateStr, inputStyle, usd, useSuccessMessage,
} from "../../components/ui.jsx";
import { CheckboxChips, KeyValues, Muted, Row, SectionTitle, Select, Tabs } from "../../components/forms.jsx";
import { DocumentsPanel } from "../../components/DocumentsPanel.jsx";
import { StatementView } from "../../components/StatementView.jsx";
import { InviteLinkNotice } from "./AdminUsersView.jsx";

const EMPTY = {
  kind: "Entity", legal_name: "", display_name: "", company: "", category: "Family office", country: "",
  ticket_min: "", ticket_max: "", destinations: [], relationship_note: "", notes: "",
  investment_inclination: "", net_worth_band: "", data_consent: false,
};

function toForm(i) {
  const f = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) if (i[k] !== null && i[k] !== undefined) f[k] = i[k];
  f.data_consent = Boolean(i.data_consent_at);
  return f;
}

function payload(form, restricted) {
  const p = { ...form, ticket_min: form.ticket_min === "" ? null : form.ticket_min, ticket_max: form.ticket_max === "" ? null : form.ticket_max };
  if (!restricted) { delete p.investment_inclination; delete p.net_worth_band; }
  else p.investment_inclination = p.investment_inclination || null;
  return p;
}

function InvestorForm({ form, setForm, restricted }) {
  const set = (k) => (val) => setForm((f) => ({ ...f, [k]: val }));
  const input = (k, props = {}) => <input style={inputStyle} value={form[k] ?? ""} onChange={(e) => set(k)(e.target.value)} {...props} />;
  return (
    <>
      <Row>
        <Field label="Investor kind" required><Select value={form.kind} onChange={set("kind")} options={INVESTOR_KINDS} /></Field>
        <Field label="Category" required><Select value={form.category} onChange={set("category")} options={INVESTOR_CATEGORIES} /></Field>
      </Row>
      <Row>
        <Field label={form.kind === "Entity" ? "Legal entity name" : "Full legal name"} required>{input("legal_name", { required: true })}</Field>
        <Field label="Display name" hint="Optional short name.">{input("display_name")}</Field>
      </Row>
      <Row>
        <Field label="Company / group">{input("company")}</Field>
        <Field label="Country">{input("country")}</Field>
      </Row>
      <Row>
        <Field label="Ticket from (USD)">{input("ticket_min", { type: "number", min: 0 })}</Field>
        <Field label="Ticket up to (USD)">{input("ticket_max", { type: "number", min: 0 })}</Field>
      </Row>
      <Field label="Interested in"><CheckboxChips options={DESTINATIONS} value={form.destinations} onChange={set("destinations")} /></Field>
      <Field label="Relationship note"><textarea style={{ ...inputStyle, minHeight: 55 }} value={form.relationship_note ?? ""} onChange={(e) => set("relationship_note")(e.target.value)} /></Field>
      <Field label="Internal notes"><textarea style={{ ...inputStyle, minHeight: 45 }} value={form.notes ?? ""} onChange={(e) => set("notes")(e.target.value)} /></Field>
      {restricted && (
        <Card style={{ padding: "14px 16px 0", background: "#FFFBF2", marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#B8790A", marginBottom: 10 }}>Restricted: visible only to admins with restricted access</div>
          <Row>
            <Field label="Investment inclination"><Select value={form.investment_inclination} onChange={set("investment_inclination")} options={INCLINATIONS} placeholder="—" /></Field>
            <Field label="Net worth band" hint="e.g. USD 10-25M">{input("net_worth_band")}</Field>
          </Row>
        </Card>
      )}
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, marginBottom: 16, fontFamily: FONT }}>
        <input type="checkbox" checked={form.data_consent} onChange={(e) => set("data_consent")(e.target.checked)} />
        Investor has consented to RIV holding and processing their data
      </label>
    </>
  );
}

function ContactFields({ contact, setContact }) {
  const set = (k) => (e) => setContact((c) => ({ ...c, [k]: e.target.value }));
  return (
    <>
      <Row>
        <Field label="Contact name" required><input style={inputStyle} value={contact.name} onChange={set("name")} required /></Field>
        <Field label="Email"><input style={inputStyle} type="email" value={contact.email} onChange={set("email")} /></Field>
      </Row>
      <Row>
        <Field label="Phone"><input style={inputStyle} value={contact.phone} onChange={set("phone")} /></Field>
        <Field label="Role"><Select value={contact.role} onChange={(v) => setContact((c) => ({ ...c, role: v }))} options={CONTACT_ROLES} /></Field>
      </Row>
    </>
  );
}

const EMPTY_CONTACT = { name: "", email: "", phone: "", role: "Decision-maker" };

function DuplicateList({ duplicates }) {
  return duplicates.map((d) => (
    <div key={d.id} style={{ padding: "8px 0", borderTop: `1px solid ${BRAND.line}`, fontSize: 12.5 }}>
      <strong>{d.legal_name}</strong>{d.company && d.company !== d.legal_name ? ` (${d.company})` : ""} · <StatusBadge status={d.registration_status} colors={REGISTRATION_COLORS} />
      <div><Muted>{d.reasons.join(", ")}{d.partner_name ? ` · registered by ${d.partner_name}` : ""} · #{d.id}</Muted></div>
    </div>
  ));
}

function AddInvestorModal({ restricted, onClose, onCreated }) {
  const [form, setForm] = useState({ ...EMPTY, source: "RIV direct" });
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [dupes, setDupes] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e, confirm = false) {
    e?.preventDefault();
    setSaving(true); setError("");
    try {
      const { investor } = await api.createInvestor({ ...payload(form, restricted), contact, confirm_not_duplicate: confirm });
      onCreated(investor);
    } catch (err) {
      if (err.status === 409 && err.data?.duplicates) setDupes(err.data.duplicates);
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Add investor (RIV direct)" onClose={onClose} width={720}>
      <form onSubmit={submit}>
        <ErrorBanner text={error} />
        {dupes && (
          <Card style={{ padding: 14, marginBottom: 16, borderColor: "#F3D9A4", background: "#FFFBF2" }}>
            <DuplicateList duplicates={dupes} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
              <GhostButton onClick={() => submit(null, true)} disabled={saving}>It's a different investor, add anyway</GhostButton>
            </div>
          </Card>
        )}
        <Field label="Source"><Select value={form.source} onChange={(v) => setForm((f) => ({ ...f, source: v }))} options={ADMIN_INVESTOR_SOURCES} /></Field>
        <InvestorForm form={form} setForm={setForm} restricted={restricted} />
        <SectionTitle>Primary contact</SectionTitle>
        <ContactFields contact={contact} setContact={setContact} />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Add investor"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ReviewPanel({ investor, duplicates, onReviewed, setError }) {
  const [reason, setReason] = useState("");
  const [dupOf, setDupOf] = useState(duplicates[0]?.id || "");
  const [busy, setBusy] = useState(false);
  async function decide(decision) {
    setBusy(true); setError("");
    try {
      await api.reviewInvestor(investor.id, { decision, reason, duplicate_of_investor_id: dupOf || undefined });
      onReviewed(decision);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ padding: 16, marginBottom: 18, background: "#FFFBF2", borderColor: "#F3D9A4" }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Review this submission</div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 10 }}>
        Submitted by {investor.partner_name || "RIV"} on {dateStr(investor.created_at)}. Approving locks credit to the partner for their credit window.
      </div>
      {duplicates.length ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 600, fontSize: 12.5, color: "#B8790A" }}><AlertTriangle size={14} /> Possible duplicates (the partner can't see these)</div>
          <DuplicateList duplicates={duplicates} />
        </div>
      ) : <div style={{ fontSize: 12.5, marginBottom: 12 }}>No possible duplicates found.</div>}
      <Field label="Reason" hint="Needed to reject. Shown to the partner when rejecting."><input style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <PrimaryButton disabled={busy} onClick={() => decide("approve")}>Approve</PrimaryButton>
        <GhostButton disabled={busy} onClick={() => decide("reject")}>Reject</GhostButton>
        {duplicates.length > 0 && (
          <>
            <GhostButton disabled={busy} onClick={() => decide("duplicate")}>Mark as duplicate of</GhostButton>
            <Select value={dupOf} onChange={(v) => setDupOf(Number(v))} options={duplicates.map((d) => ({ value: d.id, label: `#${d.id} ${d.legal_name}` }))} style={{ width: 240, padding: "8px 10px" }} />
          </>
        )}
      </div>
    </Card>
  );
}

function ContactsPanel({ investor, contacts, reload, setError, showSuccess }) {
  const [adding, setAdding] = useState(false);
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [inviteLink, setInviteLink] = useState("");

  async function run(fn, msg) {
    setError("");
    try { const r = await fn(); if (msg) showSuccess(msg); reload(); return r; } catch (err) { setError(err.message); }
  }
  async function invite(c) {
    setInviteLink("");
    const r = await run(() => api.inviteContact(investor.id, c.id));
    if (r) { setInviteLink(r.inviteLink || ""); if (r.emailSent) showSuccess(`Portal invite emailed to ${c.name}.`); }
  }

  return (
    <div>
      <InviteLinkNotice link={inviteLink} />
      <DataTable columns={["Contact", "Role", "Portal login", ""]}>
        {contacts.map((c) => (
          <tr key={c.id}>
            <td style={cellStyle}>
              <div style={{ fontWeight: 600 }}>{c.name} {c.is_primary && <Muted>· primary</Muted>}</div>
              <Muted>{[c.email, c.phone].filter(Boolean).join(" · ") || "No email"}</Muted>
            </td>
            <td style={cellStyle}>{c.role}</td>
            <td style={cellStyle}>{!c.user_id ? <Muted>None</Muted> : c.login_status === "active" ? "Active" : c.login_status === "invited" ? <Muted>Invited</Muted> : "Suspended"}</td>
            <td style={{ ...cellStyle, textAlign: "right" }}>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                {investor.registration_status === "Approved" && c.email && (!c.user_id || c.login_status === "invited") && (
                  <GhostButton icon={Mail} style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => invite(c)}>{c.user_id ? "Resend invite" : "Invite to portal"}</GhostButton>
                )}
                {!c.is_primary && <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => run(() => api.updateContact(investor.id, c.id, { is_primary: true }), `${c.name} is now the primary contact.`)}>Make primary</GhostButton>}
                {!c.is_primary && !c.user_id && <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => window.confirm(`Remove ${c.name}?`) && run(() => api.removeContact(investor.id, c.id), "Contact removed.")}>Remove</GhostButton>}
              </div>
            </td>
          </tr>
        ))}
      </DataTable>
      {investor.registration_status !== "Approved" && <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>Portal invites unlock once the investor is approved.</div>}
      {adding ? (
        <Card style={{ padding: 16, marginTop: 14 }}>
          <ContactFields contact={contact} setContact={setContact} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
            <PrimaryButton onClick={async () => { const r = await run(() => api.addContact(investor.id, contact), "Contact added."); if (r) { setAdding(false); setContact(EMPTY_CONTACT); } }}>Add contact</PrimaryButton>
          </div>
        </Card>
      ) : (
        <div style={{ marginTop: 12 }}><GhostButton icon={Plus} onClick={() => setAdding(true)}>Add contact</GhostButton></div>
      )}
    </div>
  );
}

// Statement and the updates logged against this investor (PRD 6.10).
function InvestorRecordPanel({ investorId }) {
  const [updates, setUpdates] = useState(null);
  const load = useCallback((asOf) => api.investorRecord(investorId, asOf).then((r) => { setUpdates(r.updates); return r; }), [investorId]);
  return (
    <div>
      <StatementView load={load} />
      <SectionTitle>Updates sent</SectionTitle>
      {!updates ? <Spinner /> : !updates.length ? <Muted>No updates sent to this investor yet.</Muted> : (
        <DataTable columns={["Update", "Sent", "Read"]}>
          {updates.map((u) => (
            <tr key={u.id}>
              <td style={cellStyle}><strong>{u.title}</strong><div><Muted>{u.type} · {u.vehicle_name}{u.status === "Withdrawn" ? " · withdrawn" : ""}</Muted></div></td>
              <td style={cellStyle}>{dateStr(u.delivered_at)}</td>
              <td style={cellStyle}>{u.first_read_at ? dateStr(u.first_read_at) : <Muted>Not yet</Muted>}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}

function InvestorDetailModal({ investorId, onClose, onChanged, onOpenKyc }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState("details");
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.getInvestor(investorId).then((r) => { setData(r); setForm(toForm(r.investor)); }).catch((e) => setError(e.message));
  }, [investorId]);
  useEffect(load, [load]);

  if (!data) return <Modal title="Investor" onClose={onClose} width={780}>{error ? <ErrorBanner text={error} /> : <Spinner />}</Modal>;
  const inv = data.investor;

  async function save(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try { await api.updateInvestor(inv.id, payload(form, data.restricted)); showSuccess("Investor saved."); load(); onChanged(); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function startKyc() {
    setError("");
    try { const { file } = await api.openKyc(inv.id); onOpenKyc(file.id); }
    catch (err) { setError(err.message); }
  }

  return (
    <Modal title={inv.display_name || inv.legal_name} onClose={onClose} width={780}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <StatusBadge status={inv.registration_status} colors={REGISTRATION_COLORS} />
        <StatusBadge status={inv.kyc_status} colors={KYC_COLORS} label={`KYC: ${inv.kyc_status}`} />
        <Muted>{inv.kind} · {inv.category} · {inv.source}{inv.partner_name ? ` via ${inv.partner_name}` : ""}</Muted>
      </div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      {inv.registration_status === "Submitted" && (
        <ReviewPanel investor={inv} duplicates={data.duplicates} setError={setError} onReviewed={(d) => { showSuccess(d === "approve" ? "Investor approved." : d === "reject" ? "Submission rejected." : "Marked as duplicate."); load(); onChanged(); }} />
      )}
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "details", label: "Details" },
        { id: "contacts", label: "Contacts", count: data.contacts.length },
        { id: "kyc", label: "KYC" },
        { id: "documents", label: "Documents" },
        { id: "record", label: "Statement and updates" },
      ]} />
      {tab === "details" && (
        <>
          <KeyValues rows={[
            ["Registered", `${dateStr(inv.created_at)} · ${inv.source}${inv.partner_name ? ` (${inv.partner_name})` : ""}`],
            inv.partner_id && ["Partner credit until", dateStr(inv.credit_expires_at)],
            inv.registration_status === "Rejected" && ["Rejection reason", inv.rejection_reason],
            inv.registration_status === "Duplicate" && ["Duplicate of", `#${inv.duplicate_of_investor_id}${inv.rejection_reason ? ` · ${inv.rejection_reason}` : ""}`],
            ["Ticket", inv.ticket_min || inv.ticket_max ? `${usd(inv.ticket_min)} – ${usd(inv.ticket_max)}` : null],
            inv.relationship_type && ["Source (relationship)", inv.relationship_type],
            inv.linkedin_url && ["LinkedIn", <a key="li" href={inv.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ color: BRAND.blue }}>{inv.linkedin_url.replace(/^https?:\/\//, "")}</a>],
            inv.previously_invested && ["Previously invested in startups", inv.previously_invested],
            inv.personally_interacted && ["Partner has met them", inv.personally_interacted],
            inv.informed_about_riv && ["They know about RIV", inv.informed_about_riv],
            inv.intro_methods?.length > 0 && ["Introduced via", inv.intro_methods.join(", ")],
            inv.expected_support && ["Partner's support", inv.expected_support],
            inv.partner_id && ["Introduction consent", inv.data_consent_at ? `Confirmed ${dateStr(inv.data_consent_at)}` : "Not recorded"],
          ]} />
          {!data.restricted && <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>Net worth and investment inclination are hidden: they need restricted access.</div>}
          <SectionTitle>Edit</SectionTitle>
          <form onSubmit={save}>
            <InvestorForm form={form} setForm={setForm} restricted={data.restricted} />
            <div style={{ display: "flex", justifyContent: "flex-end" }}><PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</PrimaryButton></div>
          </form>
        </>
      )}
      {tab === "contacts" && <ContactsPanel investor={inv} contacts={data.contacts} reload={load} setError={setError} showSuccess={showSuccess} />}
      {tab === "kyc" && (
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <StatusBadge status={inv.kyc_status} colors={KYC_COLORS} />
          </div>
          <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14, lineHeight: 1.6 }}>
            {inv.registration_status !== "Approved" ? "KYC starts once the investor is approved." :
              inv.kyc_status === "Not started" ? "Opening KYC creates the checklist and emails the investor's portal users." :
              inv.kyc_status === "Cleared" || inv.kyc_status === "Rejected" || inv.kyc_status === "Expired" ? "Opening a refresh starts a new checklist; the current file stays as history." :
              "KYC is in progress. Open the KYC page to review it."}
          </div>
          {inv.registration_status === "Approved" && ["Not started", "Cleared", "Rejected", "Expired"].includes(inv.kyc_status) && (
            <PrimaryButton onClick={startKyc}>{inv.kyc_status === "Not started" ? "Open KYC checklist" : "Open KYC refresh"}</PrimaryButton>
          )}
          {!["Not started"].includes(inv.kyc_status) && data.restricted && <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>Review it on the KYC page.</div>}
        </Card>
      )}
      {tab === "documents" && <DocumentsPanel linkedType="investor" linkedId={inv.id} />}
      {tab === "record" && <InvestorRecordPanel investorId={inv.id} />}
    </Modal>
  );
}

export function AdminInvestorsView({ onOpenKyc }) {
  const [list, setList] = useState(null);
  const [restricted, setRestricted] = useState(false);
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    api.listInvestors({ q }).then((r) => { setList(r.investors); setRestricted(r.restricted); }).catch((e) => setError(e.message));
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const shown = (list || []).filter((i) => status === "all" || i.registration_status === status);
  const count = (s) => (list || []).filter((i) => i.registration_status === s).length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 360 }}>
          <Search size={14} color={MUTED} style={{ position: "absolute", left: 11, top: 12 }} />
          <input style={{ ...inputStyle, paddingLeft: 32 }} placeholder="Search name, company or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>Add investor</PrimaryButton>
      </div>
      <ErrorBanner text={error} />
      <Tabs value={status} onChange={setStatus} tabs={[
        { id: "all", label: "All", count: list?.length },
        { id: "Submitted", label: "To review", count: count("Submitted") },
        { id: "Approved", label: "Approved", count: count("Approved") },
        { id: "Rejected", label: "Rejected", count: count("Rejected") },
        { id: "Duplicate", label: "Duplicates", count: count("Duplicate") },
      ]} />
      {!list ? <Spinner /> : !shown.length ? (
        <EmptyState icon={Users} title="No investors here" text="Partners' submissions, RIV-direct investors and Bigin imports appear here." />
      ) : (
        <DataTable columns={["Investor", "Category", "Source", "Status", "KYC", "Added"]}>
          {shown.map((i) => (
            <tr key={i.id} onClick={() => setOpenId(i.id)} style={{ cursor: "pointer" }}>
              <td style={cellStyle}>
                <div style={{ fontWeight: 600 }}>{i.display_name || i.legal_name}</div>
                <Muted>{[i.kind, i.primary_contact_name, i.primary_contact_email].filter(Boolean).join(" · ")}</Muted>
              </td>
              <td style={cellStyle}>{i.category}</td>
              <td style={cellStyle}>{i.source}{i.partner_name && <div><Muted>{i.partner_name}</Muted></div>}</td>
              <td style={cellStyle}><StatusBadge status={i.registration_status} colors={REGISTRATION_COLORS} /></td>
              <td style={cellStyle}>{i.registration_status === "Approved" ? <StatusBadge status={i.kyc_status} colors={KYC_COLORS} /> : <Muted>—</Muted>}</td>
              <td style={cellStyle}>{dateStr(i.created_at)}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {showAdd && <AddInvestorModal restricted={restricted} onClose={() => setShowAdd(false)} onCreated={(inv) => { setShowAdd(false); load(); setOpenId(inv.id); }} />}
      {openId && <InvestorDetailModal investorId={openId} onClose={() => setOpenId(null)} onChanged={load} onOpenKyc={(fileId) => { setOpenId(null); onOpenKyc(fileId); }} />}
    </div>
  );
}
