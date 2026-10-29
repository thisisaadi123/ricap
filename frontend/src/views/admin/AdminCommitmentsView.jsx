// Commitments pipeline and the commitment workspace (PRD 6.5-6.8, 6.13).
// One stage at a time; each move needs its evidence (PRD 7).
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Circle, Plus, Send, X } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { COMMITMENT_STATUS_COLORS, DOC_TYPES, EXIT_STATUSES, FLOWS, stageLabel } from "../../constants.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateStr, dateTimeStr, inputStyle, usd, useSuccessMessage,
} from "../../components/ui.jsx";
import { DocLink, FileButton, KeyValues, Muted, Row, SectionTitle, Select, SignatureBadge, Tabs, uploadedLine } from "../../components/forms.jsx";
import { StageProgress } from "../../components/progress.jsx";
import { DocumentsPanel } from "../../components/DocumentsPanel.jsx";

// ---------- new commitment ----------
function NewCommitmentModal({ presetVehicleId, onClose, onCreated }) {
  const [investors, setInvestors] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState({ investor_id: "", vehicle_id: presetVehicleId || "", indicative_amount: "", expected_close_date: "", note: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.listInvestors({ status: "Approved" }).then((r) => setInvestors(r.investors)).catch(() => {});
    api.listVehicles().then((r) => setVehicles(r.vehicles.filter((v) => v.status === "Open"))).catch(() => {});
    api.listDeals?.().then((r) => setVehicles((vs) => [...vs, ...r.deals.filter((d) => d.deal_status === "Live").map((d) => ({ id: d.vehicle_id, name: d.name }))])).catch(() => {});
  }, []);
  const set = (k) => (val) => setForm((f) => ({ ...f, [k]: val }));
  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try { const { commitment } = await api.createCommitment(form); onCreated(commitment.id); } catch (err) { setError(err.message); setSaving(false); }
  }
  return (
    <Modal title="New commitment" onClose={onClose} width={560}>
      <form onSubmit={submit}>
        <ErrorBanner text={error} />
        <Field label="Investor" required hint="Approved investors only."><Select value={form.investor_id} onChange={set("investor_id")} placeholder="Choose…" options={investors.map((i) => ({ value: i.id, label: `${i.display_name || i.legal_name} (${i.kind})` }))} /></Field>
        <Field label="Vehicle or IB deal" required><Select value={form.vehicle_id} onChange={set("vehicle_id")} placeholder="Choose…" options={vehicles.map((v) => ({ value: v.id, label: v.name }))} /></Field>
        <Row>
          <Field label="Indicative amount (USD)" required><input type="number" min={1} style={inputStyle} value={form.indicative_amount} onChange={(e) => set("indicative_amount")(e.target.value)} required /></Field>
          <Field label="Expected close"><input type="date" style={inputStyle} value={form.expected_close_date} onChange={(e) => set("expected_close_date")(e.target.value)} /></Field>
        </Row>
        <Field label="Note"><input style={inputStyle} value={form.note} onChange={(e) => set("note")(e.target.value)} /></Field>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>The eligibility check runs straight away. If KYC isn't cleared or the amount is below the minimum, it waits at Intent.</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving || !form.investor_id || !form.vehicle_id}>{saving ? "Creating…" : "Create"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// ---------- workspace pieces ----------
function EligibilityCard({ data, run }) {
  const { eligibility, commitment: c } = data;
  const minCheck = eligibility.checks.find((x) => x.key === "minimum");
  return (
    <Card style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Eligibility {eligibility.pass ? <span style={{ color: "#1E7A34" }}>· passes</span> : <span style={{ color: BRAND.coralDark }}>· not yet</span>}</div>
        {c.stage === "Intent" && c.status === "Active" && <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => run(() => api.checkEligibility(c.id), "Eligibility re-checked.")}>Re-check</GhostButton>}
      </div>
      {eligibility.checks.map((x) => (
        <div key={x.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, padding: "4px 0" }}>
          {x.ok ? <Check size={14} color="#1E7A34" style={{ marginTop: 2 }} /> : <X size={14} color={BRAND.coralDark} style={{ marginTop: 2 }} />}
          <div>{x.label}{x.detail && <div><Muted>{x.detail}</Muted></div>}</div>
        </div>
      ))}
      {c.stage === "Intent" && minCheck && !minCheck.ok && c.status === "Active" && (
        <GhostButton style={{ marginTop: 10, padding: "6px 10px", fontSize: 12 }} onClick={() => {
          const reason = window.prompt("Why may this commitment go below the minimum ticket? This is logged.");
          if (reason) run(() => api.overrideMinimum(c.id, reason), "Minimum overridden.");
        }}>Override minimum…</GhostButton>
      )}
    </Card>
  );
}

function NextStepCard({ data, run, setError }) {
  const c = data.commitment;
  const next = data.next_stage;
  const [fields, setFields] = useState({ committed_amount: c.committed_amount || c.indicative_amount, shares_issued: "", share_certificate_no: "", funds_transferred_amount: "", funds_transferred_date: "" });
  const [due, setDue] = useState("");
  if (!next || c.status !== "Active") return null;
  const r = data.next;
  const needsAmount = next === "Fully executed" || next === "Definitive documents signed";
  const isShares = next === "Shares issued";
  const isFundsTransferred = next === "Funds transferred";
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  // Stages driven by their own actions rather than a "move" button.
  if (next === "Eligible") return null;
  if (next === "Funds due") {
    return (
      <Card style={{ padding: 16, marginBottom: 16, borderColor: BRAND.coral }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Next: issue payment instructions</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>Instructions use the vehicle's approved receiving account and ask for {usd(data.outstanding ?? c.committed_amount)}. The investor sees them in the portal.</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", maxWidth: 420 }}>
          <Field label="Due date" style={{ marginBottom: 0, flex: 1 }}><input type="date" style={inputStyle} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <PrimaryButton icon={Send} disabled={!due} onClick={() => run(() => api.issueInstructions(c.id, due), "Payment instructions issued.")}>Issue</PrimaryButton>
        </div>
      </Card>
    );
  }
  if (next === "Funds received") return null; // handled by the receipts card
  if (next === "Soft commitment confirmed") {
    return (
      <Card style={{ padding: 16, marginBottom: 16, borderColor: BRAND.coral }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Next: investor confirms the soft commitment</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>The investor can confirm in the portal. If they confirmed by email, upload the email to record it.</div>
        <FileButton label="Upload emailed confirmation" onFile={(f) => run(() => api.softConfirmByEmail(c.id, f), "Soft commitment confirmed.")} />
      </Card>
    );
  }

  return (
    <Card style={{ padding: 16, marginBottom: 16, borderColor: BRAND.coral }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Next: {stageLabel(c.flow, next)}</div>
      {r.evidence.map((e) => (
        <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${BRAND.line}`, fontSize: 12.5 }}>
          {e.met ? <Check size={14} color="#1E7A34" /> : <Circle size={12} color={MUTED} />}
          <div style={{ flex: 1 }}>
            {e.label}
            {e.documents.map((d) => <div key={d.id}><DocLink doc={d} onError={setError} /></div>)}
          </div>
          <FileButton label={e.met ? "Add another" : "Upload"} onFile={(f) => run(() => api.uploadDocument(f, {
            linked_type: "commitment", linked_id: c.id, doc_type: e.doc_type, evidence_stage: next, title: e.label,
            confidentiality: ["Offer documents issued", "Shares issued"].includes(next) ? "Shareable with investor" : "Internal",
            signature_status: next === "Offer documents issued" ? "Sent" : next === "Fully executed" ? "Fully executed" : "Not required",
          }), `${e.label} uploaded.`)} />
        </div>
      ))}
      {!r.evidence.length && <Muted>No documents needed for this stage.</Muted>}
      {(needsAmount || isShares || isFundsTransferred) && (
        <Row>
          {needsAmount && <Field label="Committed amount (USD)" style={{ marginTop: 12 }}><input type="number" min={1} style={inputStyle} value={fields.committed_amount} onChange={set("committed_amount")} /></Field>}
          {isShares && <Field label="Shares issued" style={{ marginTop: 12 }}><input type="number" min={0} style={inputStyle} value={fields.shares_issued} onChange={set("shares_issued")} /></Field>}
          {isShares && <Field label="Share certificate number" style={{ marginTop: 12 }}><input style={inputStyle} value={fields.share_certificate_no} onChange={set("share_certificate_no")} /></Field>}
          {isFundsTransferred && <Field label="Amount the startup confirms (USD)" style={{ marginTop: 12 }}><input type="number" min={1} style={inputStyle} value={fields.funds_transferred_amount} onChange={set("funds_transferred_amount")} /></Field>}
          {isFundsTransferred && <Field label="Date received by the startup" style={{ marginTop: 12 }}><input type="date" style={inputStyle} value={fields.funds_transferred_date} onChange={set("funds_transferred_date")} /></Field>}
        </Row>
      )}
      {r.needs.length > 0 && <div style={{ fontSize: 12, color: MUTED, margin: "10px 0" }}>Still needed: {r.needs.join(" ")}</div>}
      <PrimaryButton style={{ marginTop: 10 }} onClick={() => run(() => api.advanceCommitment(c.id, {
        to_stage: next,
        ...(needsAmount ? { committed_amount: fields.committed_amount } : {}),
        ...(isShares ? { shares_issued: fields.shares_issued, share_certificate_no: fields.share_certificate_no } : {}),
        ...(isFundsTransferred ? { funds_transferred_amount: fields.funds_transferred_amount, funds_transferred_date: fields.funds_transferred_date } : {}),
      }), `Moved to ${stageLabel(c.flow, next)}.`)}>Move to {stageLabel(c.flow, next)}</PrimaryButton>
    </Card>
  );
}

function PaymentsCard({ data, run }) {
  const c = data.commitment;
  const live = data.instructions.find((i) => !i.voided_at);
  const [r, setR] = useState({ amount: "", value_date: "", bank_reference: "", counterparty: "" });
  const [file, setFile] = useState(null);
  if (c.flow !== "HoldCo" || !["Funds due", "Funds received", "Shares issued", "Active shareholder"].includes(c.stage)) return null;
  const set = (k) => (e) => setR((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      <SectionTitle>Payment</SectionTitle>
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <KeyValues rows={[["Committed", usd(c.committed_amount)], ["Received", usd(c.received_total)], ["Outstanding", usd(data.outstanding)]]} />
        {live && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: BRAND.cream, fontSize: 12.5 }}>
            <strong>Live instructions</strong> · {usd(live.amount)} due {dateStr(live.due_date)} · ref {live.reference}
            <div><Muted>{live.bank_name} · {live.bank_iban} · issued by {live.issued_by_name} {dateTimeStr(live.issued_at)}</Muted></div>
            {c.stage === "Funds due" && <GhostButton style={{ marginTop: 8, padding: "5px 10px", fontSize: 12 }} onClick={() => { const reason = window.prompt("Why void these instructions?"); if (reason) run(() => api.voidInstructions(c.id, live.id, reason), "Instructions voided. Issue new ones."); }}>Void instructions</GhostButton>}
          </div>
        )}
        {c.stage === "Funds due" && !live && c.status === "Active" && <IssueAgain c={c} run={run} />}
        {c.stage === "Funds due" && c.status === "Active" && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Record money received</div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>Check the bank statement first. An investor's own payment confirmation isn't proof.</div>
            <Row>
              <Field label="Amount (USD)" required><input type="number" min={0} style={inputStyle} value={r.amount} onChange={set("amount")} /></Field>
              <Field label="Value date" required><input type="date" style={inputStyle} value={r.value_date} onChange={set("value_date")} /></Field>
            </Row>
            <Row>
              <Field label="Bank reference" required><input style={inputStyle} value={r.bank_reference} onChange={set("bank_reference")} /></Field>
              <Field label="Paid by"><input style={inputStyle} value={r.counterparty} onChange={set("counterparty")} /></Field>
            </Row>
            <Field label="Bank proof (statement line or credit advice)" required><input type="file" style={inputStyle} accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
            <PrimaryButton disabled={!file} onClick={async () => { const ok = await run(() => api.recordReceipt(c.id, file, r), "Receipt recorded."); if (ok) { setR({ amount: "", value_date: "", bank_reference: "", counterparty: "" }); setFile(null); } }}>Record receipt</PrimaryButton>
          </div>
        )}
        {data.receipts.length > 0 && (
          <div style={{ marginTop: 16 }}>
            {data.receipts.map((m) => (
              <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, padding: "7px 0", borderTop: `1px solid ${BRAND.line}`, opacity: m.voided_at ? 0.5 : 1 }}>
                <div style={{ flex: 1 }}>
                  <strong>{usd(m.amount)}</strong> on {dateStr(m.value_date)} · ref {m.bank_reference}{m.counterparty ? ` · ${m.counterparty}` : ""}
                  <div><DocLink doc={{ id: m.proof_document_id, filename: m.proof_filename }} /> <Muted>recorded by {m.recorded_by_name}</Muted></div>
                  {m.voided_at && <Muted style={{ color: BRAND.coralDark }}>Voided: {m.void_reason}</Muted>}
                </div>
                {!m.voided_at && ["Funds due", "Funds received"].includes(c.stage) && (
                  <GhostButton style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => { const reason = window.prompt("Why void this receipt? It stays on record."); if (reason) run(() => api.voidReceipt(c.id, m.id, reason), "Receipt voided."); }}>Void</GhostButton>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function IssueAgain({ c, run }) {
  const [due, setDue] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", maxWidth: 420, marginTop: 12 }}>
      <Field label="Due date for new instructions" style={{ marginBottom: 0, flex: 1 }}><input type="date" style={inputStyle} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <PrimaryButton disabled={!due} onClick={() => run(() => api.issueInstructions(c.id, due), "New instructions issued.")}>Issue</PrimaryButton>
    </div>
  );
}

// Investor uploads (signed copies) can be tagged as stage evidence.
function InvestorUploads({ data, run, setError }) {
  const uploads = data.documents.filter((d) => d.source === "Investor upload" && !d.voided_at);
  const [tag, setTag] = useState({});
  if (!uploads.length) return null;
  const stages = FLOWS[data.commitment.flow];
  return (
    <>
      <SectionTitle>From the investor</SectionTitle>
      <Card style={{ padding: 16, marginBottom: 16 }}>
        {uploads.map((d) => (
          <div key={d.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, padding: "7px 0", borderBottom: `1px solid ${BRAND.line}` }}>
            <div style={{ flex: "1 1 220px" }}><DocLink doc={d} onError={setError} /><div><Muted>{d.doc_type} · {dateTimeStr(d.uploaded_at)}{d.evidence_stage ? ` · evidence for ${d.evidence_stage}` : ""}</Muted></div></div>
            {d.doc_type !== "Payment confirmation" && (
              <>
                <Select style={{ width: 200, padding: "6px 8px", fontSize: 12 }} value={tag[d.id]?.doc_type || ""} placeholder="Document type…" options={DOC_TYPES.filter((t) => !["KYC document", "Signed document"].includes(t))} onChange={(val) => setTag((x) => ({ ...x, [d.id]: { ...x[d.id], doc_type: val } }))} />
                <Select style={{ width: 190, padding: "6px 8px", fontSize: 12 }} value={tag[d.id]?.evidence_stage || ""} placeholder="Evidence for stage…" options={stages.slice(2)} onChange={(val) => setTag((x) => ({ ...x, [d.id]: { ...x[d.id], evidence_stage: val } }))} />
                <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} disabled={!tag[d.id]?.doc_type || !tag[d.id]?.evidence_stage} onClick={() => run(() => api.updateDocument(d.id, tag[d.id]), "Tagged as evidence.")}>Use as evidence</GhostButton>
              </>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}

// IB deals: data-room access (PRD 6.8.2 stage 3), granted after the NDA.
function DataRoomCard({ c, run }) {
  const idx = FLOWS.IB.indexOf(c.stage);
  if (c.flow !== "IB" || idx < FLOWS.IB.indexOf("NDA signed")) return null;
  return (
    <Card style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Data room</div>
        {c.data_room_granted_at ? <Muted>Access granted {dateTimeStr(c.data_room_granted_at)}</Muted> : <Muted>No access yet</Muted>}
        {c.status === "Active" && (
          <div style={{ marginLeft: "auto" }}>
            {c.data_room_granted_at
              ? <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => run(() => api.dataRoom(c.id, "revoke"), "Access revoked.")}>Revoke access</GhostButton>
              : <PrimaryButton style={{ padding: "7px 12px" }} onClick={() => run(() => api.dataRoom(c.id, "grant"), "Access granted. The investor now sees the data-room link.")}>Grant access</PrimaryButton>}
          </div>
        )}
      </div>
      {c.funds_transferred_amount && <div style={{ fontSize: 12.5, marginTop: 10 }}>Startup confirmed {usd(c.funds_transferred_amount)} received on {dateStr(c.funds_transferred_date)}.</div>}
    </Card>
  );
}

function ExitControls({ c, run }) {
  const [status, setStatus] = useState("On hold");
  if (c.status !== "Active" && c.status !== "On hold") {
    return <GhostButton onClick={() => { const note = window.prompt("Why reopen it? This is logged."); if (note) run(() => api.reopenCommitment(c.id, note), "Reopened."); }}>Reopen</GhostButton>;
  }
  const options = EXIT_STATUSES.filter((s) => s !== c.status);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {c.status === "On hold" && <GhostButton onClick={() => { const note = window.prompt("Note for taking it off hold"); if (note) run(() => api.reopenCommitment(c.id, note), "Back to active."); }}>Resume</GhostButton>}
      <Select style={{ width: 140, padding: "7px 8px", fontSize: 12.5 }} value={status} onChange={setStatus} options={options} />
      <GhostButton onClick={() => { const reason = window.prompt(`Reason for "${status}"`); if (reason) run(() => api.exitCommitment(c.id, status, reason), `Marked ${status.toLowerCase()}.`); }}>Apply</GhostButton>
    </div>
  );
}

export function CommitmentWorkspace({ commitmentId, onBack }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("work");
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [note, setNote] = useState("");
  const load = useCallback(() => { api.getCommitment(commitmentId).then(setData).catch((e) => setError(e.message)); }, [commitmentId]);
  useEffect(load, [load]);

  async function run(fn, msg) {
    setError("");
    try { await fn(); if (msg) showSuccess(msg); load(); return true; } catch (e) { setError(e.message); load(); return false; }
  }

  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const c = data.commitment;
  return (
    <div>
      <GhostButton icon={ArrowLeft} onClick={onBack} style={{ marginBottom: 14, padding: "7px 12px" }}>All commitments</GhostButton>
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18 }}>{c.investor_name} → {c.vehicle_name}</div>
          <StatusBadge status={c.status} colors={COMMITMENT_STATUS_COLORS} />
          <div style={{ marginLeft: "auto" }}><ExitControls c={c} run={run} /></div>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, margin: "6px 0 14px" }}>
          Indicative {usd(c.indicative_amount)}{c.committed_amount ? ` · committed ${usd(c.committed_amount)}` : ""} · {c.source}{c.partner_name ? ` · credited to ${c.partner_name}` : ""} · created via {c.created_via} {dateStr(c.created_at)}
          {c.exit_reason && <div style={{ color: BRAND.coralDark }}>{c.status}: {c.exit_reason}</div>}
        </div>
        <StageProgress flow={c.flow} stages={data.stages} current={c.stage} dimmed={c.status !== "Active"} />
      </Card>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "work", label: "Next steps" }, { id: "documents", label: "Documents", count: data.documents.filter((d) => !d.voided_at).length }, { id: "history", label: "History & notes" }]} />
      {tab === "work" && (
        <>
          {c.stage === "Intent" && <EligibilityCard data={data} run={run} />}
          <DataRoomCard c={c} run={run} />
          <NextStepCard key={`${c.stage}-${c.status}`} data={data} run={run} setError={setError} />
          <PaymentsCard data={data} run={run} />
          <InvestorUploads data={data} run={run} setError={setError} />
          {c.stage !== "Intent" && <EligibilityCard data={data} run={run} />}
          {!data.next_stage && c.status === "Active" && <Card style={{ padding: 16 }}><Muted>This commitment has reached its last stage.</Muted></Card>}
        </>
      )}
      {tab === "documents" && <DocumentsPanel linkedType="commitment" linkedId={c.id} />}
      {tab === "history" && (
        <>
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={inputStyle} placeholder="Add a note or log a question from the investor" value={note} onChange={(e) => setNote(e.target.value)} />
              <GhostButton icon={Plus} disabled={!note} onClick={async () => { if (await run(() => api.addCommitmentNote(c.id, note), "Note added.")) setNote(""); }}>Add</GhostButton>
            </div>
            {data.notes.map((n) => <div key={n.id} style={{ fontSize: 12.5, padding: "8px 0", borderBottom: `1px solid ${BRAND.line}` }}>{n.note}<div><Muted>{n.author_name} · {dateTimeStr(n.created_at)}</Muted></div></div>)}
          </Card>
          <DataTable columns={["When", "Change", "By", "Note"]}>
            {[...data.events].reverse().map((e) => (
              <tr key={e.id}>
                <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>{dateTimeStr(e.created_at)}</td>
                <td style={cellStyle}>{e.to_stage ? `${e.from_stage ? `${stageLabel(c.flow, e.from_stage)} → ` : ""}${stageLabel(c.flow, e.to_stage)}` : `${e.from_status || ""} → ${e.to_status}`}</td>
                <td style={cellStyle}>{e.actor_name || "—"}</td>
                <td style={{ ...cellStyle, color: MUTED }}>{e.note}</td>
              </tr>
            ))}
          </DataTable>
        </>
      )}
    </div>
  );
}

// ---------- list ----------
export function AdminCommitmentsView({ vehicleFilter, setVehicleFilter, openId, setOpenId }) {
  const [rows, setRows] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [status, setStatus] = useState("live");
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    api.listCommitments({ status, vehicle_id: vehicleFilter || undefined }).then((r) => setRows(r.commitments)).catch((e) => setError(e.message));
  }, [status, vehicleFilter]);
  useEffect(() => { if (!openId) load(); }, [load, openId]);
  useEffect(() => {
    api.listVehicles().then((r) => setVehicles(r.vehicles)).catch(() => {});
    api.listDeals?.().then((r) => setVehicles((vs) => [...vs, ...r.deals.map((d) => ({ id: d.vehicle_id, name: d.name }))])).catch(() => {});
  }, []);

  if (openId) return <CommitmentWorkspace commitmentId={openId} onBack={() => setOpenId(null)} />;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <Select style={{ width: 260 }} value={vehicleFilter || ""} onChange={(v) => setVehicleFilter(v ? Number(v) : null)} placeholder="All vehicles and deals" options={vehicles.map((v) => ({ value: v.id, label: v.name }))} />
        <PrimaryButton icon={Plus} style={{ marginLeft: "auto" }} onClick={() => setShowNew(true)}>New commitment</PrimaryButton>
      </div>
      <ErrorBanner text={error} />
      <Tabs value={status} onChange={setStatus} tabs={[{ id: "live", label: "Live" }, { id: "Active", label: "Active" }, { id: "On hold", label: "On hold" }, { id: "Dropped", label: "Dropped" }, { id: "Rejected", label: "Rejected" }, { id: "Withdrawn", label: "Withdrawn" }]} />
      {!rows ? <Spinner /> : !rows.length ? (
        <EmptyState icon={Send} title="No commitments here" text="Commitments are created by RIV, by partners for their investors, or by investors saying they're interested." />
      ) : (
        <DataTable columns={["Investor", "Vehicle", "Stage", "Amount", "Received", "Updated"]}>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><div style={{ fontWeight: 600 }}>{r.investor_name}</div><Muted>{r.created_via}{r.partner_name ? ` · ${r.partner_name}` : ""}</Muted></td>
              <td style={cellStyle}>{r.vehicle_name}</td>
              <td style={cellStyle}>{stageLabel(r.flow, r.stage)}{r.status !== "Active" && <div><StatusBadge status={r.status} colors={COMMITMENT_STATUS_COLORS} /></div>}{r.stage === "Intent" && r.eligible === false && r.status === "Active" && <div><Muted>Waiting on eligibility</Muted></div>}</td>
              <td style={cellStyle}>{usd(r.committed_amount || r.indicative_amount)}{!r.committed_amount && <div><Muted>indicative</Muted></div>}</td>
              <td style={cellStyle}>{r.flow === "HoldCo" && Number(r.received_total) > 0 ? usd(r.received_total) : <Muted>—</Muted>}</td>
              <td style={cellStyle}>{dateStr(r.updated_at)}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {showNew && <NewCommitmentModal presetVehicleId={vehicleFilter} onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); setOpenId(id); }} />}
    </div>
  );
}
