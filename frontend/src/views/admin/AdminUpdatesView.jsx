// Investor updates (PRD 6.10, 8.10): draft, attach files, publish to the
// investors in a vehicle or deal (or some of them), and see who got and read it.
import React, { useCallback, useEffect, useState } from "react";
import { Megaphone, Plus } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, MUTED } from "../../brand.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateTimeStr, inputStyle, useSuccessMessage,
} from "../../components/ui.jsx";
import { CheckboxChips, Muted, Row, SectionTitle, Select, Tabs } from "../../components/forms.jsx";
import { DocumentsPanel } from "../../components/DocumentsPanel.jsx";

const UPDATE_TYPES = ["Monthly letter", "Quarterly account statement", "Deal update", "Notice", "Event"];
const STATUS_COLORS = {
  Draft: { bg: "#F3F1EE", fg: "#8A857F" }, Published: { bg: "#E6F4EA", fg: "#1E7A34" }, Withdrawn: { bg: "#FBEAEA", fg: BRAND.coralDark },
};
const EMPTY = { type: "Monthly letter", vehicle_id: "", title: "", body: "", audience: "All", selected_investor_ids: [], shareable_with_partners: false };
const EMAIL_LABELS = { Sent: "email sent", Skipped: "email not configured", Failed: "email failed", Pending: "email waiting", Sending: "email waiting", None: "no email" };

function DraftForm({ initial, targets, onSave, onCancel, saveLabel }) {
  const [form, setForm] = useState(initial);
  const [audience, setAudience] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (val) => setForm((f) => ({ ...f, [k]: val }));
  useEffect(() => {
    if (!form.vehicle_id) { setAudience([]); return; }
    api.updateAudience(form.vehicle_id).then((r) => setAudience(r.investors)).catch((e) => setError(e.message));
  }, [form.vehicle_id]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try { await onSave({ ...form, vehicle_id: Number(form.vehicle_id) }); } catch (err) { setError(err.message); setSaving(false); }
  }
  return (
    <form onSubmit={submit}>
      <ErrorBanner text={error} />
      <Row>
        <Field label="Vehicle or deal" required><Select value={form.vehicle_id} onChange={(val) => setForm((f) => ({ ...f, vehicle_id: val, selected_investor_ids: [] }))} placeholder="Choose…" options={targets.map((t) => ({ value: t.id, label: `${t.name} (${t.type})` }))} /></Field>
        <Field label="Type" required><Select value={form.type} onChange={set("type")} options={UPDATE_TYPES} /></Field>
      </Row>
      <Field label="Title" required><input style={inputStyle} value={form.title} onChange={(e) => set("title")(e.target.value)} required /></Field>
      <Field label="Text" required hint="Facts only: no advice or recommendations (PRD 6.10)."><textarea style={{ ...inputStyle, minHeight: 170, resize: "vertical" }} value={form.body} onChange={(e) => set("body")(e.target.value)} required /></Field>
      <Field label="Who gets it">
        <Select value={form.audience} onChange={set("audience")} options={[{ value: "All", label: `All investors in this vehicle or deal (${audience.length})` }, { value: "Selected", label: "Selected investors" }]} />
      </Field>
      {form.audience === "Selected" && (audience.length
        ? <Field label="Choose investors"><CheckboxChips value={form.selected_investor_ids.map((id) => audience.find((a) => a.id === id)?.name).filter(Boolean)} options={audience.map((a) => a.name)} onChange={(names) => set("selected_investor_ids")(audience.filter((a) => names.includes(a.name)).map((a) => a.id))} /></Field>
        : <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14 }}>Nobody to choose yet.</div>)}
      <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 12, lineHeight: 1.6 }}>Investors count once their commitment is past Eligible: offer documents issued, soft commitment recorded or NDA signed.</div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, marginBottom: 16 }}>
        <input type="checkbox" checked={form.shareable_with_partners} onChange={(e) => set("shareable_with_partners")(e.target.checked)} />
        Partners can read this. If unticked, they only see that an update went out.
      </label>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
        <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : saveLabel}</PrimaryButton>
      </div>
    </form>
  );
}

function UpdateDetail({ id, targets, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const load = useCallback(() => { api.getUpdate(id).then(setData).catch((e) => setError(e.message)); }, [id]);
  useEffect(load, [load]);
  async function run(fn, msg) {
    setError("");
    try { await fn(); showSuccess(msg); load(); onChanged(); } catch (e) { setError(e.message); }
  }
  const u = data?.update;
  return (
    <Modal title={u ? u.title : "Update"} onClose={onClose} width={760}>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      {!u ? <Spinner /> : editing ? (
        <DraftForm initial={{ type: u.type, vehicle_id: u.vehicle_id, title: u.title, body: u.body, audience: u.audience, selected_investor_ids: u.selected_investor_ids, shareable_with_partners: u.shareable_with_partners }} targets={targets} saveLabel="Save draft" onCancel={() => setEditing(false)}
          onSave={async (body) => { await api.editUpdate(id, body); setEditing(false); showSuccess("Draft saved."); load(); onChanged(); }} />
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            <StatusBadge status={u.status} colors={STATUS_COLORS} />
            <Muted>{u.type} · {u.vehicle_name}{u.shareable_with_partners ? " · partners can read" : ""}</Muted>
          </div>
          {u.withdraw_reason && <div style={{ fontSize: 12.5, color: BRAND.coralDark, marginBottom: 10 }}>Withdrawn: {u.withdraw_reason}</div>}
          <Card style={{ padding: 14, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.65, marginBottom: 14 }}>{u.body}</Card>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {u.status === "Draft" && <PrimaryButton onClick={() => { if (window.confirm("Publish this update? Investors are alerted straight away.")) run(() => api.publishUpdate(id), "Published."); }}>Publish</PrimaryButton>}
            {u.status === "Draft" && <GhostButton onClick={() => setEditing(true)}>Edit</GhostButton>}
            {u.status !== "Withdrawn" && <GhostButton onClick={() => { const reason = window.prompt("Why withdraw this? It stays on record but leaves the portals."); if (reason) run(() => api.withdrawUpdate(id, reason), "Withdrawn."); }}>Withdraw</GhostButton>}
          </div>
          <SectionTitle>Attachments</SectionTitle>
          <DocumentsPanel linkedType="update" linkedId={id} />
          {u.status !== "Draft" && (
            <>
              <SectionTitle>Delivery log</SectionTitle>
              <div style={{ fontSize: 12.5, marginBottom: 8 }}>Published by {u.published_by_name} on {dateTimeStr(u.published_at)}. Read by {u.read_count} of {u.delivered}.</div>
              <DataTable columns={["Investor", "Email", "Read"]}>
                {data.deliveries.map((d) => (
                  <tr key={d.investor_id}>
                    <td style={cellStyle}>{d.investor_name}</td>
                    <td style={cellStyle}>{d.recipients.length ? d.recipients.map((r) => <div key={r.email}><Muted>{r.email}: {EMAIL_LABELS[r.email_status]}</Muted></div>) : <Muted>No portal login yet</Muted>}</td>
                    <td style={cellStyle}>{d.first_read_at ? dateTimeStr(d.first_read_at) : <Muted>Not yet</Muted>}</td>
                  </tr>
                ))}
              </DataTable>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

export function AdminUpdatesView() {
  const [updates, setUpdates] = useState(null);
  const [targets, setTargets] = useState([]);
  const [status, setStatus] = useState("Published");
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { api.listUpdates().then((r) => setUpdates(r.updates)).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    load();
    api.updateTargets().then((r) => setTargets(r.targets)).catch((e) => setError(e.message));
  }, [load]);
  if (!updates) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const rows = updates.filter((u) => u.status === status);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><PrimaryButton icon={Plus} onClick={() => setShowNew(true)}>New update</PrimaryButton></div>
      <ErrorBanner text={error} />
      <Tabs value={status} onChange={setStatus} tabs={["Published", "Draft", "Withdrawn"].map((s) => ({ id: s, label: s, count: updates.filter((u) => u.status === s).length }))} />
      {!rows.length ? <EmptyState icon={Megaphone} title="Nothing here" text="Letters, statements, deal updates, notices and events you send to investors appear here." /> : (
        <DataTable columns={["Update", "Vehicle or deal", "Audience", "Read", "Date"]}>
          {rows.map((u) => (
            <tr key={u.id} onClick={() => setOpenId(u.id)} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><strong>{u.title}</strong><div><Muted>{u.type}</Muted></div></td>
              <td style={cellStyle}>{u.vehicle_name}</td>
              <td style={cellStyle}>{u.status === "Draft" ? (u.audience === "All" ? "All investors" : `${u.selected_investor_ids.length} selected`) : `${u.delivered} investor${u.delivered === 1 ? "" : "s"}`}</td>
              <td style={cellStyle}>{u.status === "Draft" ? "—" : `${u.read_count} of ${u.delivered}`}</td>
              <td style={cellStyle}>{dateTimeStr(u.published_at || u.updated_at)}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {showNew && (
        <Modal title="New update" onClose={() => setShowNew(false)} width={680}>
          <DraftForm initial={EMPTY} targets={targets} saveLabel="Save draft" onCancel={() => setShowNew(false)}
            onSave={async (body) => { const r = await api.createUpdate(body); setShowNew(false); setStatus("Draft"); load(); setOpenId(r.update.id); }} />
        </Modal>
      )}
      {openId && <UpdateDetail id={openId} targets={targets} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
