// What counsel supplies (LEG-4, LEG-6): KYC checklists and agreement
// templates. Checklist changes apply to KYC files opened from now on.
import React, { useCallback, useEffect, useState } from "react";
import { FileStack, Plus } from "lucide-react";
import { api, openDocument } from "../../api.js";
import { MUTED } from "../../brand.js";
import { DOC_TYPES, INVESTOR_KINDS, TEMPLATE_COLORS } from "../../constants.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateStr, inputStyle, useSuccessMessage,
} from "../../components/ui.jsx";
import { Muted, Row, SectionTitle, Select, Tabs } from "../../components/forms.jsx";

function ChecklistTab({ setError, showSuccess }) {
  const [items, setItems] = useState(null);
  const [kind, setKind] = useState("Individual");
  const [draft, setDraft] = useState({ label: "", description: "", required: true });

  const load = useCallback(() => { api.listChecklist().then((r) => setItems(r.items)).catch((e) => setError(e.message)); }, [setError]);
  useEffect(load, [load]);

  async function run(fn, msg) {
    setError("");
    try { await fn(); showSuccess(msg); load(); return true; } catch (e) { setError(e.message); return false; }
  }

  if (!items) return <Spinner />;
  const shown = items.filter((i) => i.kyc_type === kind);
  const nextOrder = Math.max(0, ...shown.map((i) => i.sort_order)) + 10;

  return (
    <div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12, lineHeight: 1.6 }}>
        The starting lists come from the PRD. Replace them with Novo Juris's final checklists. Changes apply to KYC opened from now on; files already open keep their items.
      </div>
      <Tabs value={kind} onChange={setKind} tabs={INVESTOR_KINDS.map((k) => ({ id: k, label: `${k} investors`, count: items.filter((i) => i.kyc_type === k && i.active).length }))} />
      <DataTable columns={["Order", "Item", "Required", "In use", ""]}>
        {shown.map((i) => (
          <tr key={i.id} style={{ opacity: i.active ? 1 : 0.5 }}>
            <td style={{ ...cellStyle, width: 70 }}>{i.sort_order}</td>
            <td style={cellStyle}><div style={{ fontWeight: 600 }}>{i.label}</div>{i.description && <Muted>{i.description}</Muted>}</td>
            <td style={cellStyle}>
              <input type="checkbox" checked={i.required} onChange={() => run(() => api.updateChecklistItem(i.id, { required: !i.required }), "Saved.")} />
            </td>
            <td style={cellStyle}>
              <input type="checkbox" checked={i.active} onChange={() => run(() => api.updateChecklistItem(i.id, { active: !i.active }), i.active ? "Item switched off." : "Item switched on.")} />
            </td>
            <td style={{ ...cellStyle, textAlign: "right" }}>
              <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => {
                const label = window.prompt("Item name", i.label);
                if (label && label !== i.label) run(() => api.updateChecklistItem(i.id, { label }), "Renamed.");
              }}>Rename</GhostButton>
            </td>
          </tr>
        ))}
      </DataTable>
      <Card style={{ padding: 16, marginTop: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Add an item for {kind.toLowerCase()} investors</div>
        <Row>
          <Field label="Item" required><input style={inputStyle} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
          <Field label="Guidance for the investor"><input style={inputStyle} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
        </Row>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, marginBottom: 12 }}>
          <input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} /> Required to clear KYC
        </label>
        <GhostButton icon={Plus} onClick={async () => {
          if (await run(() => api.addChecklistItem({ ...draft, kyc_type: kind, sort_order: nextOrder }), "Item added.")) setDraft({ label: "", description: "", required: true });
        }}>Add item</GhostButton>
      </Card>
    </div>
  );
}

function UploadTemplateModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ name: "", doc_type: "Subscription Agreement (SSA)", version_label: "", notes: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!file) return setError("Choose a file.");
    setSaving(true); setError("");
    try { await api.uploadTemplate(file, form); onDone(); } catch (err) { setError(err.message); setSaving(false); }
  }
  return (
    <Modal title="Upload template" onClose={onClose} width={560}>
      <form onSubmit={submit}>
        <ErrorBanner text={error} />
        <Field label="File" required><input type="file" style={inputStyle} accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
        <Row>
          <Field label="Template name" required hint="Same name for every version, e.g. HoldCo SSA."><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
          <Field label="Version" required hint="e.g. Novo Juris final, Nov 2026"><input style={inputStyle} value={form.version_label} onChange={(e) => setForm({ ...form, version_label: e.target.value })} required /></Field>
        </Row>
        <Field label="Document type"><Select value={form.doc_type} onChange={(v) => setForm({ ...form, doc_type: v })} options={DOC_TYPES.filter((t) => t !== "KYC document")} /></Field>
        <Field label="Notes"><input style={inputStyle} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving}>{saving ? "Uploading…" : "Upload as draft"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function AgreementTemplatesTab({ setError, showSuccess }) {
  const [templates, setTemplates] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const load = useCallback(() => { api.listTemplates().then((r) => setTemplates(r.templates)).catch((e) => setError(e.message)); }, [setError]);
  useEffect(load, [load]);

  async function setStatus(t, status) {
    setError("");
    try { await api.setTemplateStatus(t.id, status); showSuccess(`${t.name} (${t.version_label}) is now ${status.toLowerCase()}.`); load(); } catch (e) { setError(e.message); }
  }

  if (!templates) return <Spinner />;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12 }}>
        <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>Counsel-approved templates (SSA, SHA, NDA, engagement letter, partner agreement). Activating a version retires the previous active one with the same name.</div>
        <PrimaryButton icon={Plus} onClick={() => setShowUpload(true)}>Upload template</PrimaryButton>
      </div>
      {!templates.length ? <EmptyState icon={FileStack} title="No templates yet" text="Upload Novo Juris's drafts here as they arrive." /> : (
        <DataTable columns={["Template", "Type", "Status", "Added", ""]}>
          {templates.map((t) => (
            <tr key={t.id}>
              <td style={cellStyle}>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <Muted>{t.version_label}{t.notes ? ` · ${t.notes}` : ""}</Muted>
                {t.document_id && <div><button type="button" onClick={() => openDocument(t.document_id).catch((e) => setError(e.message))} style={{ background: "none", border: "none", padding: 0, color: "#2F6FEB", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>{t.filename}</button></div>}
              </td>
              <td style={cellStyle}>{t.doc_type}</td>
              <td style={cellStyle}><StatusBadge status={t.status} colors={TEMPLATE_COLORS} /></td>
              <td style={cellStyle}>{dateStr(t.created_at)}<div><Muted>{t.created_by_name}</Muted></div></td>
              <td style={{ ...cellStyle, textAlign: "right" }}>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {t.status !== "Active" && <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setStatus(t, "Active")}>Make active</GhostButton>}
                  {t.status !== "Retired" && <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setStatus(t, "Retired")}>Retire</GhostButton>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {showUpload && <UploadTemplateModal onClose={() => setShowUpload(false)} onDone={() => { setShowUpload(false); showSuccess("Template uploaded as draft."); load(); }} />}
    </div>
  );
}

export function AdminTemplatesView() {
  const [tab, setTab] = useState("kyc");
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  return (
    <div>
      <Tabs value={tab} onChange={(t) => { setTab(t); setError(""); }} tabs={[{ id: "kyc", label: "KYC checklists" }, { id: "agreements", label: "Agreement templates" }]} />
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      {tab === "kyc" ? <ChecklistTab setError={setError} showSuccess={showSuccess} /> : <AgreementTemplatesTab setError={setError} showSuccess={showSuccess} />}
    </div>
  );
}
