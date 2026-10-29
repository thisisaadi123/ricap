// KYC queue and the KYC file review screen (PRD 6.4). In v1 RIV admins do
// the compliance work (LEG-5); this page needs restricted access.
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { CLASSIFICATIONS, KYC_COLORS, KYC_ITEM_COLORS, PEP_STATUSES, RISK_COLORS, RISK_RATINGS, SANCTIONS_RESULTS } from "../../constants.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateStr, inputStyle, useSuccessMessage,
} from "../../components/ui.jsx";
import { DocLink, FileButton, Muted, Row, SectionTitle, Select, Tabs, uploadedLine } from "../../components/forms.jsx";

const OPEN = ["Open", "Submitted", "Information requested"];

function kycLabel(f) {
  return f.expired ? "Expired" : f.status;
}

export function AdminKycQueue({ onOpen }) {
  const [files, setFiles] = useState(null);
  const [status, setStatus] = useState("Submitted");
  const [error, setError] = useState("");

  useEffect(() => {
    setFiles(null);
    api.listKyc(status === "all" ? undefined : status).then((r) => setFiles(r.files)).catch((e) => setError(e.message));
  }, [status]);

  if (error) return <ErrorBanner text={error} />;
  return (
    <div>
      <Tabs value={status} onChange={setStatus} tabs={[
        { id: "Submitted", label: "Waiting for review" }, { id: "Open", label: "With investor" },
        { id: "Information requested", label: "Info requested" }, { id: "Cleared", label: "Cleared" },
        { id: "Expired", label: "Expired" }, { id: "Rejected", label: "Rejected" }, { id: "all", label: "All" },
      ]} />
      {!files ? <Spinner /> : !files.length ? (
        <EmptyState icon={ShieldCheck} title="Nothing here" text="Open a KYC checklist from an approved investor's KYC tab." />
      ) : (
        <DataTable columns={["Investor", "Status", "Checklist", "Risk", "Opened", "Refresh due"]}>
          {files.map((f) => (
            <tr key={f.id} onClick={() => onOpen(f.id)} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><div style={{ fontWeight: 600 }}>{f.investor_name}</div><Muted>{f.kyc_type} · {f.category}</Muted></td>
              <td style={cellStyle}><StatusBadge status={kycLabel(f)} colors={KYC_COLORS} />{f.submitted_at && f.status === "Submitted" && <div><Muted>since {dateStr(f.submitted_at)}</Muted></div>}</td>
              <td style={cellStyle}>{f.verified_count}/{f.required_count} verified{f.to_review_count > 0 && <div><Muted style={{ color: "#6B3FBF" }}>{f.to_review_count} to review</Muted></div>}</td>
              <td style={cellStyle}>{f.risk_rating ? <StatusBadge status={f.risk_rating} colors={RISK_COLORS} /> : <Muted>—</Muted>}</td>
              <td style={cellStyle}>{dateStr(f.created_at)}</td>
              <td style={cellStyle}>{dateStr(f.refresh_due)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}

function ItemRow({ fileId, item, editable, onChanged, setError }) {
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const docs = item.documents.filter((d) => !d.voided_at);

  async function review(status) {
    setError("");
    try { await api.reviewKycItem(fileId, item.id, { status, note: status === "Rejected" ? note : undefined }); setRejecting(false); setNote(""); onChanged(); }
    catch (e) { setError(e.message); }
  }

  return (
    <tr>
      <td style={cellStyle}>
        <div style={{ fontWeight: 600 }}>{item.label}{!item.required && <Muted> · optional</Muted>}</div>
        {item.description && <Muted>{item.description}</Muted>}
        {item.status === "Rejected" && item.review_note && <div><Muted style={{ color: BRAND.coralDark }}>Sent back: {item.review_note}</Muted></div>}
        {item.reviewed_by_name && item.status === "Verified" && <div><Muted>Verified by {item.reviewed_by_name}, {dateStr(item.reviewed_at)}</Muted></div>}
      </td>
      <td style={cellStyle}>
        {docs.length ? docs.map((d) => <div key={d.id} style={{ marginBottom: 4 }}><DocLink doc={d} onError={setError} /><div><Muted>{uploadedLine(d)}</Muted></div></div>) : <Muted>Nothing uploaded</Muted>}
      </td>
      <td style={cellStyle}><StatusBadge status={item.status} colors={KYC_ITEM_COLORS} /></td>
      <td style={{ ...cellStyle, textAlign: "right", minWidth: 220 }}>
        {editable && (rejecting ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input style={{ ...inputStyle, padding: "6px 8px", fontSize: 12 }} placeholder="What's wrong?" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
            <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => review("Rejected")}>Send back</GhostButton>
            <GhostButton style={{ padding: "6px 8px" }} onClick={() => setRejecting(false)}><X size={13} /></GhostButton>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {docs.length > 0 && item.status !== "Verified" && <GhostButton icon={Check} style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => review("Verified")}>Verify</GhostButton>}
            {docs.length > 0 && <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setRejecting(true)}>Reject</GhostButton>}
            <FileButton label="Upload" onFile={async (file) => {
              setError("");
              try { await api.uploadKycItem(fileId, item.id, file, "Received by email"); onChanged(); } catch (e) { setError(e.message); }
            }} />
          </div>
        ))}
      </td>
    </tr>
  );
}

export function AdminKycFile({ fileId, onBack, onOpenFile }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [screening, setScreening] = useState(null);
  const [ubo, setUbo] = useState({ name: "", ownership_pct: "", nationality: "" });
  const [newItem, setNewItem] = useState("");
  const [decision, setDecision] = useState({ decision: "Cleared", note: "", refresh_due: "" });

  const load = useCallback(() => {
    api.getKyc(fileId).then((r) => {
      setData(r);
      const f = r.file;
      setScreening({
        pep_status: f.pep_status || "", sanctions_result: f.sanctions_result || "", sanctions_checked_at: f.sanctions_checked_at ? String(f.sanctions_checked_at).slice(0, 10) : "",
        sanctions_method: f.sanctions_method || "", source_of_funds: f.source_of_funds || "", tax_self_cert: f.tax_self_cert,
        risk_rating: f.risk_rating || "", classification: f.classification || "",
      });
    }).catch((e) => setError(e.message));
  }, [fileId]);
  useEffect(load, [load]);

  async function run(fn, msg) {
    setError("");
    try { await fn(); if (msg) showSuccess(msg); load(); return true; } catch (e) { setError(e.message); return false; }
  }

  if (!data || !screening) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const { file, items, ubos, history } = data;
  const editable = file.is_current && OPEN.includes(file.status);
  const expired = file.status === "Cleared" && file.refresh_due && new Date(file.refresh_due) < new Date(new Date().toDateString());
  const set = (k) => (val) => setScreening((s) => ({ ...s, [k]: val }));
  const required = items.filter((i) => i.required);
  const verified = required.filter((i) => i.status === "Verified").length;

  return (
    <div>
      <GhostButton icon={ArrowLeft} onClick={onBack} style={{ marginBottom: 14, padding: "7px 12px" }}>KYC queue</GhostButton>
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18 }}>{file.investor_name}</div>
          <StatusBadge status={expired ? "Expired" : file.status} colors={KYC_COLORS} />
          {!file.is_current && <Muted>Old file (history)</Muted>}
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>
          {file.kyc_type} KYC · opened {dateStr(file.created_at)}{file.submitted_at ? ` · submitted ${dateStr(file.submitted_at)}` : ""} · {verified}/{required.length} required items verified
          {file.decided_at ? ` · decided ${dateStr(file.decided_at)}` : ""}{file.refresh_due ? ` · refresh due ${dateStr(file.refresh_due)}` : ""}
        </div>
        {file.decision_note && <div style={{ fontSize: 12.5, marginTop: 8 }}><strong>Note:</strong> {file.decision_note}</div>}
      </Card>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />

      <SectionTitle>Checklist</SectionTitle>
      <DataTable columns={["Item", "Documents", "Status", ""]}>
        {items.map((it) => <ItemRow key={it.id} fileId={file.id} item={it} editable={editable} onChanged={load} setError={setError} />)}
      </DataTable>
      {editable && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, maxWidth: 520 }}>
          <input style={inputStyle} placeholder="Ask for another document (e.g. bank reference letter)" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <GhostButton icon={Plus} onClick={async () => { if (newItem && await run(() => api.addKycItem(file.id, { label: newItem }), "Item added to this checklist.")) setNewItem(""); }}>Add</GhostButton>
        </div>
      )}

      <SectionTitle>Screening and classification</SectionTitle>
      <Card style={{ padding: 18 }}>
        <Row>
          <Field label="PEP status"><Select value={screening.pep_status} onChange={set("pep_status")} options={PEP_STATUSES} placeholder="—" disabled={!editable} /></Field>
          <Field label="Sanctions screening"><Select value={screening.sanctions_result} onChange={set("sanctions_result")} options={SANCTIONS_RESULTS} placeholder="—" disabled={!editable} /></Field>
          <Field label="Screened on"><input type="date" style={inputStyle} value={screening.sanctions_checked_at} disabled={!editable} onChange={(e) => set("sanctions_checked_at")(e.target.value)} /></Field>
        </Row>
        <Field label="How it was screened" hint="Manual in v1, e.g. the lists checked."><input style={inputStyle} value={screening.sanctions_method} disabled={!editable} onChange={(e) => set("sanctions_method")(e.target.value)} /></Field>
        <Field label="Source of funds / wealth"><textarea style={{ ...inputStyle, minHeight: 55 }} value={screening.source_of_funds} disabled={!editable} onChange={(e) => set("source_of_funds")(e.target.value)} /></Field>
        <Row>
          <Field label="Risk rating"><Select value={screening.risk_rating} onChange={set("risk_rating")} options={RISK_RATINGS} placeholder="—" disabled={!editable} /></Field>
          <Field label="Classification"><Select value={screening.classification} onChange={set("classification")} options={CLASSIFICATIONS} placeholder="—" disabled={!editable} /></Field>
        </Row>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, marginBottom: 14 }}>
          <input type="checkbox" checked={screening.tax_self_cert} disabled={!editable} onChange={(e) => set("tax_self_cert")(e.target.checked)} /> FATCA / CRS self-certification collected
        </label>
        {editable && <PrimaryButton onClick={() => run(() => api.updateKyc(file.id, { ...screening, sanctions_checked_at: screening.sanctions_checked_at || null, pep_status: screening.pep_status || null, sanctions_result: screening.sanctions_result || null, risk_rating: screening.risk_rating || null, classification: screening.classification || null }), "Screening saved.")}>Save screening</PrimaryButton>}
      </Card>

      {file.kyc_type === "Entity" && (
        <>
          <SectionTitle>Ultimate beneficial owners</SectionTitle>
          <Card style={{ padding: 18 }}>
            {ubos.length ? ubos.map((u) => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: `1px solid ${BRAND.line}`, fontSize: 13 }}>
                <strong>{u.name}</strong> <Muted>{[u.ownership_pct != null ? `${Number(u.ownership_pct)}%` : null, u.nationality].filter(Boolean).join(" · ")}</Muted>
                {editable && <button style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: MUTED }} onClick={() => run(() => api.removeUbo(file.id, u.id), "Owner removed.")}><Trash2 size={14} /></button>}
              </div>
            )) : <Muted>No owners recorded yet. At least one is needed to clear an entity.</Muted>}
            {editable && (
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <input style={{ ...inputStyle, flex: "2 1 180px" }} placeholder="Name" value={ubo.name} onChange={(e) => setUbo({ ...ubo, name: e.target.value })} />
                <input style={{ ...inputStyle, flex: "1 1 90px" }} type="number" placeholder="Ownership %" value={ubo.ownership_pct} onChange={(e) => setUbo({ ...ubo, ownership_pct: e.target.value })} />
                <input style={{ ...inputStyle, flex: "1 1 120px" }} placeholder="Nationality" value={ubo.nationality} onChange={(e) => setUbo({ ...ubo, nationality: e.target.value })} />
                <GhostButton icon={Plus} onClick={async () => { if (await run(() => api.addUbo(file.id, ubo), "Owner added.")) setUbo({ name: "", ownership_pct: "", nationality: "" }); }}>Add owner</GhostButton>
              </div>
            )}
          </Card>
        </>
      )}

      {editable && (
        <>
          <SectionTitle>Decision</SectionTitle>
          <Card style={{ padding: 18 }}>
            <Row>
              <Field label="Decision"><Select value={decision.decision} onChange={(v) => setDecision({ ...decision, decision: v })} options={["Cleared", "Information requested", "Rejected"]} /></Field>
              {decision.decision === "Cleared" ? (
                <Field label="Refresh due" hint="Defaults to 12 months from today."><input type="date" style={inputStyle} value={decision.refresh_due} onChange={(e) => setDecision({ ...decision, refresh_due: e.target.value })} /></Field>
              ) : <div />}
            </Row>
            <Field label={decision.decision === "Information requested" ? "What the investor needs to do" : "Note"} hint={decision.decision === "Information requested" ? "The investor sees this and gets an email." : decision.decision === "Rejected" ? "Required. Kept internal; the investor is told to contact RIV." : "Optional."}>
              <textarea style={{ ...inputStyle, minHeight: 55 }} value={decision.note} onChange={(e) => setDecision({ ...decision, note: e.target.value })} />
            </Field>
            <PrimaryButton onClick={() => run(() => api.decideKyc(file.id, { ...decision, refresh_due: decision.refresh_due || null }), `KYC ${decision.decision.toLowerCase()}.`)}>Record decision</PrimaryButton>
          </Card>
        </>
      )}

      {history.length > 0 && (
        <>
          <SectionTitle>Earlier KYC files</SectionTitle>
          <DataTable columns={["Opened", "Status", "Decided", "Refresh due"]}>
            {history.map((h) => (
              <tr key={h.id} onClick={() => onOpenFile(h.id)} style={{ cursor: "pointer" }}>
                <td style={cellStyle}>{dateStr(h.created_at)}</td>
                <td style={cellStyle}><StatusBadge status={h.status} colors={KYC_COLORS} /></td>
                <td style={cellStyle}>{dateStr(h.decided_at)}</td>
                <td style={cellStyle}>{dateStr(h.refresh_due)}</td>
              </tr>
            ))}
          </DataTable>
        </>
      )}
    </div>
  );
}

// Queue and file in one tab; the open file id can also come from the
// Investors page.
export function AdminKycView({ openFileId, setOpenFileId }) {
  if (openFileId) return <AdminKycFile key={openFileId} fileId={openFileId} onBack={() => setOpenFileId(null)} onOpenFile={setOpenFileId} />;
  return <AdminKycQueue onOpen={setOpenFileId} />;
}
