// Document vault panel for an investor or partner record (PRD 8.7):
// upload, signature status (tracked by hand until Zoho Sign is connected),
// new versions, void. Used on admin detail screens.
import React, { useCallback, useEffect, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { api } from "../api.js";
import { MUTED } from "../brand.js";
import { DOC_TYPES, SIGNATURE_STATUSES } from "../constants.js";
import {
  DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, SuccessBanner, Spinner,
  cellStyle, inputStyle, useSuccessMessage,
} from "./ui.jsx";
import { DocLink, FileButton, Muted, Row, Select, SignatureBadge, sizeStr, uploadedLine } from "./forms.jsx";

const SHARE_OPTION = { investor: "Shareable with investor", partner: "Shareable with partner" };

function UploadModal({ linkedType, linkedId, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ doc_type: linkedType === "partner" ? "Venture Partner Agreement" : "Other", title: "", confidentiality: "Internal", signature_status: "Not required", source: "Admin upload" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (val) => setForm((f) => ({ ...f, [k]: val }));

  async function submit(e) {
    e.preventDefault();
    if (!file) return setError("Choose a file.");
    setSaving(true); setError("");
    try {
      await api.uploadDocument(file, { ...form, linked_type: linkedType, linked_id: linkedId });
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Upload document" onClose={onClose} width={520}>
      <form onSubmit={submit}>
        <ErrorBanner text={error} />
        <Field label="File" required hint="PDF, image or Word, up to 10 MB.">
          <input type="file" style={inputStyle} accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
        <Row>
          <Field label="Type" required><Select value={form.doc_type} onChange={set("doc_type")} options={DOC_TYPES.filter((t) => t !== "KYC document")} /></Field>
          <Field label="Title" hint="Defaults to the file name."><input style={inputStyle} value={form.title} onChange={(e) => set("title")(e.target.value)} /></Field>
        </Row>
        <Row>
          <Field label="Who can see it" required>
            <Select value={form.confidentiality} onChange={set("confidentiality")} options={[
              { value: "Internal", label: "RIV team only" },
              { value: SHARE_OPTION[linkedType], label: `RIV team + this ${linkedType}` },
              { value: "Restricted", label: "Restricted admins only" },
            ]} />
          </Field>
          <Field label="Signature"><Select value={form.signature_status} onChange={set("signature_status")} options={SIGNATURE_STATUSES} /></Field>
        </Row>
        <Field label="How it arrived">
          <Select value={form.source} onChange={set("source")} options={["Admin upload", "Received by email", "Received in person"]} />
        </Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving}>{saving ? "Uploading…" : "Upload"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

export function DocumentsPanel({ linkedType, linkedId }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [showUpload, setShowUpload] = useState(false);
  const [showVoided, setShowVoided] = useState(false);

  const load = useCallback(() => {
    api.listDocuments(linkedType, linkedId).then((r) => setDocs(r.documents)).catch((e) => setError(e.message));
  }, [linkedType, linkedId]);
  useEffect(load, [load]);

  async function act(fn, message) {
    setError("");
    try { await fn(); showSuccess(message); load(); } catch (e) { setError(e.message); }
  }

  if (!docs) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const visible = docs.filter((d) => showVoided || !d.voided_at);
  const voidedCount = docs.filter((d) => d.voided_at).length;

  return (
    <div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        {voidedCount ? (
          <label style={{ fontSize: 12.5, color: MUTED, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /> Show {voidedCount} voided
          </label>
        ) : <span />}
        <PrimaryButton icon={Plus} onClick={() => setShowUpload(true)} style={{ padding: "8px 14px" }}>Upload document</PrimaryButton>
      </div>
      {!visible.length ? (
        <EmptyState icon={FolderOpen} title="No documents yet" text="Agreements, NDAs and other files for this record will appear here." />
      ) : (
        <DataTable columns={["Document", "Visible to", "Signature", ""]}>
          {visible.map((d) => (
            <tr key={d.id} style={{ opacity: d.voided_at ? 0.55 : 1 }}>
              <td style={cellStyle}>
                <div style={{ fontWeight: 600 }}>{d.title} {d.version > 1 && <Muted>v{d.version}</Muted>}</div>
                <DocLink doc={d} onError={setError} /> <Muted>{sizeStr(d.size_bytes)}</Muted>
                <div><Muted>{d.doc_type} · {uploadedLine(d)}</Muted></div>
                {d.voided_at && <div><Muted style={{ color: "#D33639" }}>Voided: {d.void_reason}</Muted></div>}
              </td>
              <td style={cellStyle}>{d.confidentiality === "Internal" ? "RIV team" : d.confidentiality === "Restricted" ? "Restricted admins" : `RIV + ${linkedType}`}</td>
              <td style={cellStyle}>
                {d.voided_at ? <SignatureBadge status={d.signature_status} /> : (
                  <Select value={d.signature_status} options={SIGNATURE_STATUSES} style={{ padding: "6px 8px", fontSize: 12, width: 170 }}
                    onChange={(val) => act(() => api.updateDocument(d.id, { signature_status: val }), `Signature status set to ${val}.`)} />
                )}
              </td>
              <td style={{ ...cellStyle, textAlign: "right" }}>
                {!d.voided_at && (
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <FileButton label="New version" onFile={(file) => act(() => api.uploadDocumentVersion(d.id, file, d.signature_status), "New version uploaded.")} />
                    <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => {
                      const reason = window.prompt("Why are you voiding this document? It stays on record.");
                      if (reason) act(() => api.voidDocument(d.id, reason), "Document voided.");
                    }}>Void</GhostButton>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {showUpload && <UploadModal linkedType={linkedType} linkedId={linkedId} onClose={() => setShowUpload(false)} onDone={() => { setShowUpload(false); showSuccess("Document uploaded."); load(); }} />}
    </div>
  );
}
