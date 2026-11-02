// Venture partner: opportunities RIV has opened to partners, proposing an
// investor for one, and following their investors' commitments (PRD 6.5,
// 9.1). Stage and amounts only; no documents.
import React, { useCallback, useEffect, useState } from "react";
import { Briefcase, Send } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { COMMITMENT_STATUS_COLORS, stageLabel } from "../../constants.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateStr, inputStyle, usd, useSuccessMessage,
} from "../../components/ui.jsx";
import { DocLink, Muted, Select } from "../../components/forms.jsx";

function ProposeModal({ opportunity, onClose, onDone }) {
  const [investors, setInvestors] = useState([]);
  const [form, setForm] = useState({ investor_id: "", indicative_amount: "", note: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.partnerInvestors().then((r) => setInvestors(r.investors.filter((i) => i.registration_status === "Approved"))).catch(() => {}); }, []);
  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try { await api.partnerPropose({ ...form, vehicle_id: opportunity.id }); onDone(); } catch (err) { setError(err.message); setSaving(false); }
  }
  return (
    <Modal title={`Propose an investor for ${opportunity.name}`} onClose={onClose} width={520}>
      <form onSubmit={submit}>
        <ErrorBanner text={error} />
        <Field label="Your investor" required hint="Only investors RIV has approved.">
          <Select value={form.investor_id} onChange={(v) => setForm({ ...form, investor_id: v })} placeholder="Choose…" options={investors.map((i) => ({ value: i.id, label: i.display_name || i.legal_name }))} />
        </Field>
        <Field label="Indicative amount (USD)" required><input type="number" min={1} style={inputStyle} value={form.indicative_amount} onChange={(e) => setForm({ ...form, indicative_amount: e.target.value })} required /></Field>
        <Field label="Note for RIV"><input style={inputStyle} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving || !form.investor_id}>{saving ? "Sending…" : "Send to RIV"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

export function OpportunityCard({ o, children, setError }) {
  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Briefcase size={17} color={BRAND.coral} />
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 15.5 }}>{o.name}</div>
      </div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 10 }}>
        {o.type === "IB Deal" ? "IB deal" : o.type}{o.target_raise ? ` · raising ${usd(o.target_raise)}` : ""}{o.pre_money_valuation ? ` · ${usd(o.pre_money_valuation)} pre-money` : ""}
      </div>
      {o.summary && <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12, whiteSpace: "pre-wrap" }}>{o.summary}</div>}
      {o.teasers?.length > 0 && <div style={{ marginBottom: 12 }}>{o.teasers.map((t) => <div key={t.id}><DocLink doc={t} onError={setError} /></div>)}</div>}
      {children}
    </Card>
  );
}

export function PartnerOpportunitiesView() {
  const [opps, setOpps] = useState(null);
  const [error, setError] = useState("");
  const [proposeFor, setProposeFor] = useState(null);
  const [success, showSuccess] = useSuccessMessage();
  useEffect(() => { api.partnerOpportunities().then((r) => setOpps(r.opportunities)).catch((e) => setError(e.message)); }, []);
  if (!opps) return error ? <ErrorBanner text={error} /> : <Spinner />;
  return (
    <div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      {!opps.length ? <EmptyState icon={Briefcase} title="Nothing open right now" text="Vehicles and deals RIV opens to partners will appear here." /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(360px, 100%), 1fr))", gap: 16 }}>
          {opps.map((o) => (
            <OpportunityCard key={o.id} o={o} setError={setError}>
              <PrimaryButton icon={Send} style={{ padding: "8px 14px" }} onClick={() => setProposeFor(o)}>Propose an investor</PrimaryButton>
            </OpportunityCard>
          ))}
        </div>
      )}
      {proposeFor && <ProposeModal opportunity={proposeFor} onClose={() => setProposeFor(null)} onDone={() => { setProposeFor(null); showSuccess("Sent to RIV. You'll see it under Commitments."); }} />}
    </div>
  );
}

export function PartnerCommitmentsView() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.partnerCommitments().then((r) => setRows(r.commitments)).catch((e) => setError(e.message)); }, []);
  if (!rows) return error ? <ErrorBanner text={error} /> : <Spinner />;
  if (!rows.length) return <EmptyState icon={Send} title="No commitments yet" text="When your investors commit to a vehicle or deal, you'll follow their progress here." />;
  return (
    <DataTable columns={["Investor", "Vehicle", "Stage", "Amount", "Received", "Updated"]}>
      {rows.map((r) => (
        <tr key={r.id}>
          <td style={cellStyle}><div style={{ fontWeight: 600 }}>{r.investor_name}</div>{!r.credited && <Muted>Outside your credit window</Muted>}</td>
          <td style={cellStyle}>{r.vehicle_name}</td>
          <td style={cellStyle}>{stageLabel(r.flow, r.stage)}{r.status !== "Active" && <div><StatusBadge status={r.status} colors={COMMITMENT_STATUS_COLORS} /></div>}</td>
          <td style={cellStyle}>{usd(r.committed_amount || r.indicative_amount)}{!r.committed_amount && <div><Muted>indicative</Muted></div>}</td>
          <td style={cellStyle}>{Number(r.received_total) > 0 ? usd(r.received_total) : <Muted>—</Muted>}</td>
          <td style={cellStyle}>{dateStr(r.updated_at)}</td>
        </tr>
      ))}
    </DataTable>
  );
}
