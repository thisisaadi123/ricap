// Investor portal for M3 (PRD 6.14): opportunities with "I'm interested",
// and My investments: stage, next action, documents, payment instructions,
// uploads and soft-commitment confirmation.
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Banknote, Briefcase, Heart } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { COMMITMENT_STATUS_COLORS, stageLabel } from "../../constants.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateStr, inputStyle, usd, useSuccessMessage,
} from "../../components/ui.jsx";
import { DocLink, FileButton, KeyValues, Muted, SectionTitle, SignatureBadge } from "../../components/forms.jsx";
import { StageProgress } from "../../components/progress.jsx";
import { OpportunityCard } from "../partner/PartnerOpportunityViews.jsx";

function InterestModal({ opportunity, onClose, onDone }) {
  const [form, setForm] = useState({ indicative_amount: opportunity.min_ticket || "", note: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try { await api.investorInterest({ ...form, vehicle_id: opportunity.id }); onDone(); } catch (err) { setError(err.message); setSaving(false); }
  }
  return (
    <Modal title={`I'm interested: ${opportunity.name}`} onClose={onClose} width={500}>
      <form onSubmit={submit}>
        <ErrorBanner text={error} />
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14, lineHeight: 1.6 }}>
          This tells RIV you're interested. It isn't a commitment; RIV will contact you about next steps.
          {opportunity.min_ticket ? ` The minimum for you is ${usd(opportunity.min_ticket)}.` : ""}
        </div>
        <Field label="How much are you thinking of (USD)?" required><input type="number" min={1} style={inputStyle} value={form.indicative_amount} onChange={(e) => setForm({ ...form, indicative_amount: e.target.value })} required /></Field>
        <Field label="Anything RIV should know?"><input style={inputStyle} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving}>{saving ? "Sending…" : "Send to RIV"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

export function InvestorOpportunitiesView({ onOpenInvestment }) {
  const [opps, setOpps] = useState(null);
  const [error, setError] = useState("");
  const [pick, setPick] = useState(null);
  const [success, showSuccess] = useSuccessMessage();
  const load = useCallback(() => { api.investorOpportunities().then((r) => setOpps(r.opportunities)).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  if (!opps) return error ? <ErrorBanner text={error} /> : <Spinner />;
  return (
    <div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>Information here is factual context from RIV, not investment advice.</div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      {!opps.length ? <EmptyState icon={Briefcase} title="Nothing open right now" text="New opportunities from RIV will appear here." /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
          {opps.map((o) => (
            <OpportunityCard key={o.id} o={o} setError={setError}>
              {o.my_commitment_id ? (
                <GhostButton onClick={() => onOpenInvestment(o.my_commitment_id)}>You're already in · view</GhostButton>
              ) : (
                <PrimaryButton icon={Heart} style={{ padding: "8px 14px" }} onClick={() => setPick(o)}>I'm interested</PrimaryButton>
              )}
            </OpportunityCard>
          ))}
        </div>
      )}
      {pick && <InterestModal opportunity={pick} onClose={() => setPick(null)} onDone={() => { setPick(null); showSuccess("Sent. RIV will be in touch, and you can follow it under My investments."); load(); }} />}
    </div>
  );
}

function InvestmentDetail({ id, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const load = useCallback(() => { api.investorCommitment(id).then(setData).catch((e) => setError(e.message)); }, [id]);
  useEffect(load, [load]);
  async function run(fn, msg) {
    setError("");
    try { await fn(); showSuccess(msg); load(); } catch (e) { setError(e.message); }
  }
  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const c = data.commitment;
  const ins = data.instruction;
  return (
    <div>
      <GhostButton icon={ArrowLeft} onClick={onBack} style={{ marginBottom: 14, padding: "7px 12px" }}>My investments</GhostButton>
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18 }}>{c.vehicle_name}</div>
          {c.status !== "Active" && <StatusBadge status={c.status} colors={COMMITMENT_STATUS_COLORS} />}
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, margin: "6px 0 14px" }}>
          {c.committed_amount ? `Committed ${usd(c.committed_amount)}` : `Indicated ${usd(c.indicative_amount)}`}
          {c.flow === "HoldCo" && c.committed_amount ? ` · paid ${usd(c.received_total)} · outstanding ${usd(c.outstanding)}` : ""}
        </div>
        <StageProgress flow={c.flow} stages={data.stages} current={c.stage} dimmed={c.status !== "Active"} />
        {c.next_action && <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "#FFF4E0", fontSize: 13 }}><strong>Next:</strong> {c.next_action}</div>}
      </Card>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />

      {data.deal && (
        <Card style={{ padding: 16, marginBottom: 16 }}>
          <KeyValues rows={[
            ["Startup", data.deal.startup_name],
            ["Round", `${usd(data.deal.round_size)} ${data.deal.instrument} at ${usd(data.deal.pre_money_valuation)} pre-money`],
            ["How you pay", "Directly to the startup, as set out in the investment agreement. Not to RIV."],
            data.deal.data_room_url && ["Data room", <a href={data.deal.data_room_url} target="_blank" rel="noopener noreferrer" style={{ color: BRAND.blue, fontWeight: 600 }}>Open the data room</a>],
            c.funds_transferred_amount && ["Startup confirmed", usd(c.funds_transferred_amount)],
          ]} />
        </Card>
      )}

      {c.flow === "Fund" && c.stage === "Soft commitment" && c.status === "Active" && (
        <Card style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>Please confirm your non-binding soft commitment of <strong>{usd(c.indicative_amount)}</strong> to {c.vehicle_name}. It helps RIV plan the Fund launch; it doesn't oblige you to invest.</div>
          <PrimaryButton onClick={() => run(() => api.investorConfirmSoft(c.id), "Thank you. Your soft commitment is confirmed.")}>Confirm soft commitment</PrimaryButton>
        </Card>
      )}

      {ins && (
        <>
          <SectionTitle>Payment instructions</SectionTitle>
          <Card style={{ padding: 16, marginBottom: 16, borderColor: BRAND.coral }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}><Banknote size={16} color={BRAND.coral} /><strong>Pay {usd(ins.amount)} by {dateStr(ins.due_date)}</strong></div>
            <KeyValues rows={[["Pay to", ins.legal_entity], ["Bank", ins.bank_name], ["Account name", ins.bank_account_name], ["IBAN", ins.bank_iban], ["SWIFT / BIC", ins.bank_swift], ["Payment reference", ins.reference]]} />
            <div style={{ fontSize: 12, color: BRAND.coralDark, marginTop: 12, lineHeight: 1.6 }}>
              RIV will never send or change bank details by email. Only pay to the account shown here, and always quote the reference.
            </div>
            <div style={{ marginTop: 12 }}><FileButton label="Upload payment confirmation" onFile={(f) => run(() => api.investorCommitmentUpload(c.id, f, "Payment confirmation"), "Thanks. RIV will confirm once the money arrives.")} /></div>
          </Card>
        </>
      )}

      {data.receipts.length > 0 && (
        <>
          <SectionTitle>Payments received by RIV</SectionTitle>
          <Card style={{ padding: 16, marginBottom: 16 }}>
            {data.receipts.map((r, i) => <div key={i} style={{ fontSize: 12.5, padding: "4px 0" }}>{usd(r.amount)} on {dateStr(r.value_date)}</div>)}
          </Card>
        </>
      )}

      <SectionTitle action={c.status === "Active" && <FileButton label="Upload a signed document" onFile={(f) => run(() => api.investorCommitmentUpload(c.id, f, "Signed document"), "Uploaded. RIV will check it.")} />}>Documents</SectionTitle>
      {data.documents.length ? (
        <DataTable columns={["Document", "Signature", "Date"]}>
          {data.documents.map((d) => (
            <tr key={d.id}>
              <td style={cellStyle}><div style={{ fontWeight: 600 }}>{d.title}</div><DocLink doc={d} onError={setError} />{d.source === "Investor upload" && <Muted> · uploaded by you</Muted>}</td>
              <td style={cellStyle}>{d.source === "Investor upload" ? <Muted>—</Muted> : <SignatureBadge status={d.signature_status} />}</td>
              <td style={cellStyle}>{dateStr(d.uploaded_at)}</td>
            </tr>
          ))}
        </DataTable>
      ) : <Card style={{ padding: 16 }}><Muted>No documents yet.</Muted></Card>}
      {c.share_certificate_no && <div style={{ fontSize: 12.5, marginTop: 14 }}>Shares issued: <strong>{Number(c.shares_issued).toLocaleString("en-US")}</strong> · certificate {c.share_certificate_no}</div>}
    </div>
  );
}

export function InvestorInvestmentsView({ openId, setOpenId }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { if (!openId) api.investorCommitments().then((r) => setRows(r.commitments)).catch((e) => setError(e.message)); }, [openId]);
  if (openId) return <InvestmentDetail id={openId} onBack={() => setOpenId(null)} />;
  if (!rows) return error ? <ErrorBanner text={error} /> : <Spinner />;
  if (!rows.length) return <EmptyState icon={Briefcase} title="No investments yet" text="Say you're interested in an opportunity and it will appear here." />;
  return (
    <DataTable columns={["Investment", "Stage", "Amount", "What's next"]}>
      {rows.map((r) => (
        <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: "pointer" }}>
          <td style={cellStyle}><div style={{ fontWeight: 600 }}>{r.vehicle_name}</div><Muted>since {dateStr(r.created_at)}</Muted></td>
          <td style={cellStyle}>{stageLabel(r.flow, r.stage)}{r.status !== "Active" && <div><StatusBadge status={r.status} colors={COMMITMENT_STATUS_COLORS} /></div>}</td>
          <td style={cellStyle}>{usd(r.committed_amount || r.indicative_amount)}{r.flow === "HoldCo" && r.committed_amount && <div><Muted>paid {usd(r.received_total)}</Muted></div>}</td>
          <td style={{ ...cellStyle, maxWidth: 360 }}>{r.next_action || <Muted>Nothing for you to do</Muted>}</td>
        </tr>
      ))}
    </DataTable>
  );
}
