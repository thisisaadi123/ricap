// Money (PRD 6.9, 8.8, 8.9, 8.12): partner payouts, every movement in and
// out with its proof, and RIV's own investments into startups.
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Banknote, Plus, Sprout } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, MUTED } from "../../brand.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateStr, dateTimeStr, inputStyle, usd, useSuccessMessage,
} from "../../components/ui.jsx";
import { DocLink, KeyValues, Muted, Row, Select, Tabs } from "../../components/forms.jsx";
import { DocumentsPanel } from "../../components/DocumentsPanel.jsx";

export const PAYOUT_COLORS = {
  Accruing: { bg: "#F3F1EE", fg: "#8A857F" }, Earned: { bg: "#FFF4E0", fg: "#B8790A" }, Approved: { bg: "#E8F0FE", fg: BRAND.blue },
  Paid: { bg: "#E6F4EA", fg: "#1E7A34" }, Cancelled: { bg: "#FBEAEA", fg: BRAND.coralDark },
};
const OUTBOUND_COLORS = {
  Proposed: { bg: "#F3F1EE", fg: "#8A857F" }, Approved: { bg: "#E8F0FE", fg: BRAND.blue }, Funded: { bg: "#E6F4EA", fg: "#1E7A34" },
  Exited: { bg: "#EFE9FB", fg: "#6B3FBF" }, "Written off": { bg: "#FBEAEA", fg: BRAND.coralDark }, Cancelled: { bg: "#F3F1EE", fg: "#8A857F" },
};

// Payment date, reference and bank proof: shared by payouts and investments.
function PayModal({ title, summary, refLabel, onSubmit, onClose }) {
  const [valueDate, setValueDate] = useState("");
  const [reference, setReference] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try { await onSubmit(file, valueDate, reference); } catch (err) { setError(err.message); setSaving(false); }
  }
  return (
    <Modal title={title} onClose={onClose} width={520}>
      <form onSubmit={submit}>
        <ErrorBanner text={error} />
        <div style={{ fontSize: 13, marginBottom: 14 }}>{summary}</div>
        <Row>
          <Field label="Payment date" required><input type="date" style={inputStyle} value={valueDate} onChange={(e) => setValueDate(e.target.value)} required /></Field>
          <Field label={refLabel} required><input style={inputStyle} value={reference} onChange={(e) => setReference(e.target.value)} required /></Field>
        </Row>
        <Field label="Bank proof" required><input type="file" style={inputStyle} accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving || !file}>{saving ? "Saving…" : "Record payment"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function PayoutsTab({ currentUser }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("Earned");
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [pay, setPay] = useState(null);
  const load = useCallback(() => { api.listPayouts().then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);

  async function run(fn, msg) {
    setError("");
    try { await fn(); showSuccess(msg); load(); } catch (e) { setError(e.message); }
  }
  async function approve(p) {
    let reason;
    if (p.over_cash_flag && !p.over_cash_reason) {
      reason = window.prompt("This payout is more than the cash fee RIV has received on this deal. Why approve it? This is logged.");
      if (!reason) return;
    }
    run(() => api.approvePayout(p.id, reason), "Approval recorded.");
  }
  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const rows = data.payouts.filter((p) => p.status === status);
  const count = (s) => data.payouts.filter((p) => p.status === s).length;
  const total = (s) => data.payouts.filter((p) => p.status === s).reduce((n, p) => n + Number(p.total), 0);

  return (
    <div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 10, lineHeight: 1.6 }}>
        HoldCo and Fund: % of capital raised, earned when the investor's money arrives. IB: % of RIV's consideration (cash fee plus sweat-equity share), earned when RIV receives its fee. Payouts above {usd(data.threshold)} need two admins.
      </div>
      <Tabs value={status} onChange={setStatus} tabs={["Earned", "Approved", "Accruing", "Paid", "Cancelled"].map((s) => ({ id: s, label: s === "Earned" ? "To approve" : s === "Approved" ? "To pay" : s, count: count(s) }))} />
      {rows.length > 0 && <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Total {usd(total(status))} including VAT</div>}
      {!rows.length ? <EmptyState icon={Banknote} title="Nothing here" text="Payouts appear when a commitment is credited to a venture partner." /> : (
        <DataTable columns={["Partner", "From", "How it's worked out", "Amount", ""]}>
          {rows.map((p) => (
            <tr key={p.id}>
              <td style={cellStyle}><div style={{ fontWeight: 600 }}>{p.partner_name}</div>{p.partner_company && <Muted>{p.partner_company}</Muted>}</td>
              <td style={cellStyle}>{p.investor_name}<div><Muted>{p.vehicle_name} · {p.stage}</Muted></div></td>
              <td style={cellStyle}>
                {Number(p.pct)}% of {usd(p.basis_amount)}
                {p.flow === "IB" && <div><Muted>cash fee {usd(p.cash_fee_part)} + sweat share {usd(p.sweat_value_part)}</Muted></div>}
                {p.over_cash_flag && <div style={{ display: "flex", gap: 5, alignItems: "center", color: "#B8790A", fontSize: 11.5, marginTop: 3 }}><AlertTriangle size={12} /> Above cash received{p.over_cash_reason ? `: ${p.over_cash_reason}` : ""}</div>}
                {p.cancel_reason && <div><Muted>{p.cancel_reason}</Muted></div>}
              </td>
              <td style={cellStyle}>
                <strong>{usd(p.total)}</strong><div><Muted>{usd(p.amount)} + {Number(p.vat_pct)}% VAT</Muted></div>
                {p.status === "Paid" && <div><Muted>Paid {dateStr(p.paid_at)} · {p.payment_reference}</Muted></div>}
              </td>
              <td style={{ ...cellStyle, textAlign: "right" }}>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {p.status === "Earned" && (p.first_approved_by === currentUser.id
                    ? <Muted>You approved. A second admin must too.</Muted>
                    : <PrimaryButton style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => approve(p)}>{p.first_approved_by ? `Second approval (first: ${p.first_approved_by_name})` : p.needs_second_admin ? "Approve (1 of 2)" : "Approve"}</PrimaryButton>)}
                  {p.status === "Approved" && <PrimaryButton style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setPay(p)}>Record payment</PrimaryButton>}
                  {!["Paid", "Cancelled"].includes(p.status) && <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => { const reason = window.prompt("Why cancel this payout? It stays on record and won't come back on its own."); if (reason) run(() => api.cancelPayout(p.id, reason), "Payout cancelled."); }}>Cancel</GhostButton>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {pay && <PayModal title={`Pay ${pay.partner_name}`} summary={<>Pay <strong>{usd(pay.total)}</strong> from the Retail X HoldCo account.</>} refLabel="Payment reference"
        onClose={() => setPay(null)}
        onSubmit={async (file, value_date, payment_reference) => { await api.payPayout(pay.id, file, { value_date, payment_reference }); setPay(null); showSuccess("Payment recorded."); load(); }} />}
    </div>
  );
}

function MovementsTab() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ direction: "", type: "", from: "", to: "", reconciled: "" });
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const load = useCallback(() => { api.listMovements(filters).then(setData).catch((e) => setError(e.message)); }, [filters]);
  useEffect(load, [load]);
  const set = (k) => (val) => setFilters((f) => ({ ...f, [k]: val }));
  async function run(fn, msg) {
    setError("");
    try { await fn(); showSuccess(msg); load(); } catch (e) { setError(e.message); }
  }
  const who = (m) => m.investor_name && m.type === "Subscription payment" ? m.investor_name : m.partner_name || m.outbound_startup || m.counterparty || "—";

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <Select style={{ width: 120 }} value={filters.direction} onChange={set("direction")} placeholder="In and out" options={["In", "Out"]} />
        <Select style={{ width: 200 }} value={filters.type} onChange={set("type")} placeholder="All types" options={["Subscription payment", "Fee receipt", "Partner payout", "Outbound investment"]} />
        <input type="date" style={{ ...inputStyle, width: 160 }} value={filters.from} onChange={(e) => set("from")(e.target.value)} aria-label="From" />
        <input type="date" style={{ ...inputStyle, width: 160 }} value={filters.to} onChange={(e) => set("to")(e.target.value)} aria-label="To" />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={filters.reconciled === "no"} onChange={(e) => set("reconciled")(e.target.checked ? "no" : "")} /> Unreconciled only</label>
      </div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      {!data ? <Spinner /> : (
        <>
          <div style={{ display: "flex", gap: 24, fontSize: 13, marginBottom: 12, flexWrap: "wrap" }}>
            <span>In: <strong style={{ color: "#1E7A34" }}>{usd(data.totals.in)}</strong></span>
            <span>Out: <strong style={{ color: BRAND.coralDark }}>{usd(data.totals.out)}</strong></span>
            <span>Unreconciled: <strong>{data.totals.unreconciled}</strong></span>
          </div>
          {!data.movements.length ? <EmptyState icon={Banknote} title="No money movements" text="Receipts, fee payments, partner payouts and RIV's investments appear here, each with its proof." /> : (
            <DataTable columns={["Date", "Type", "Who", "Amount", "Account / reference", "Proof", ""]}>
              {data.movements.map((m) => (
                <tr key={m.id} style={{ opacity: m.voided_at ? 0.5 : 1 }}>
                  <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>{dateStr(m.value_date)}</td>
                  <td style={cellStyle}>{m.type}{m.voided_at && <div><Muted style={{ color: BRAND.coralDark }}>Voided: {m.void_reason}</Muted></div>}</td>
                  <td style={cellStyle}>{who(m)}</td>
                  <td style={{ ...cellStyle, whiteSpace: "nowrap", fontWeight: 600, color: m.direction === "In" ? "#1E7A34" : BRAND.coralDark }}>{m.direction === "In" ? "+" : "−"}{usd(m.amount)}</td>
                  <td style={cellStyle}>{m.vehicle_name || "—"}<div><Muted>{m.bank_reference}</Muted></div></td>
                  <td style={cellStyle}><DocLink doc={{ id: m.proof_document_id, filename: m.proof_filename }} onError={setError} /><div><Muted>by {m.recorded_by_name}</Muted></div></td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {!m.voided_at && (
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {m.reconciled_at
                          ? <Muted>Reconciled by {m.reconciled_by_name}<br />{dateTimeStr(m.reconciled_at)}</Muted>
                          : <GhostButton style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => run(() => api.reconcileMovement(m.id), "Marked as reconciled.")}>Reconcile</GhostButton>}
                        {m.type !== "Subscription payment" && <GhostButton style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => { const reason = window.prompt("Why void this? It stays on record and its record goes back one step."); if (reason) run(() => api.voidMovement(m.id, reason), "Voided."); }}>Void</GhostButton>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </>
      )}
    </div>
  );
}

const EMPTY_OUTBOUND = { startup_name: "", rise_startup_id: "", instrument: "Equity", amount: "", stake_pct: "", valuation: "", notes: "" };

function OutboundTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(EMPTY_OUTBOUND);
  const [fund, setFund] = useState(null);
  const [docsFor, setDocsFor] = useState(null);
  const load = useCallback(() => { api.listOutbound().then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  async function run(fn, msg) {
    setError("");
    try { await fn(); showSuccess(msg); load(); return true; } catch (e) { setError(e.message); return false; }
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setReason = (o, status, text) => { const reason = window.prompt(text); if (reason) run(() => api.setOutboundStatus(o.id, status, reason), `Marked ${status.toLowerCase()}.`); };
  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
        <div style={{ fontSize: 13 }}>Deployed from the HoldCo balance sheet: <strong>{usd(data.deployed)}</strong> <Muted>· typically USD 50K–100K per startup</Muted></div>
        <PrimaryButton icon={Plus} onClick={() => { setForm(EMPTY_OUTBOUND); setShowNew(true); }}>New investment</PrimaryButton>
      </div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      {!data.investments.length ? <EmptyState icon={Sprout} title="No investments yet" text="Record each RIV investment into a startup, with its approval and bank proof." /> : (
        <DataTable columns={["Startup", "Terms", "Amount", "Status", ""]}>
          {data.investments.map((o) => (
            <tr key={o.id}>
              <td style={cellStyle}><div style={{ fontWeight: 600 }}>{o.startup_name}</div><Muted>{[o.rise_startup_id, `from ${o.source}`].filter(Boolean).join(" · ")}</Muted>{o.notes && <div><Muted>{o.notes}</Muted></div>}</td>
              <td style={cellStyle}>{o.instrument}{o.stake_pct ? ` · ${Number(o.stake_pct)}%` : ""}{o.valuation && <div><Muted>at {usd(o.valuation)}</Muted></div>}</td>
              <td style={cellStyle}>{usd(o.amount)}{o.investment_date && <div><Muted>{dateStr(o.investment_date)}</Muted></div>}</td>
              <td style={cellStyle}><StatusBadge status={o.status} colors={OUTBOUND_COLORS} />{o.approved_by_name && <div><Muted>Approved by {o.approved_by_name}</Muted></div>}{o.status_reason && <div><Muted>{o.status_reason}</Muted></div>}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {o.status === "Proposed" && <PrimaryButton style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => run(() => api.approveOutbound(o.id), "Investment approved.")}>Approve</PrimaryButton>}
                  {o.status === "Approved" && <PrimaryButton style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setFund(o)}>Record payment</PrimaryButton>}
                  {["Proposed", "Approved"].includes(o.status) && <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setReason(o, "Cancelled", "Why cancel this investment?")}>Cancel</GhostButton>}
                  {o.status === "Funded" && <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setReason(o, "Exited", "How did RIV exit?")}>Exited</GhostButton>}
                  {o.status === "Funded" && <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setReason(o, "Written off", "Why is it written off?")}>Write off</GhostButton>}
                  <GhostButton style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setDocsFor(o)}>Documents</GhostButton>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {showNew && (
        <Modal title="New investment" onClose={() => setShowNew(false)} width={560}>
          <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.createOutbound({ ...form, stake_pct: form.stake_pct || null, valuation: form.valuation || null }), "Investment proposed.")) setShowNew(false); }}>
            <Row>
              <Field label="Startup" required><input style={inputStyle} value={form.startup_name} onChange={set("startup_name")} required /></Field>
              <Field label="RISE startup ID" hint="Reference only."><input style={inputStyle} value={form.rise_startup_id} onChange={set("rise_startup_id")} /></Field>
            </Row>
            <Row>
              <Field label="Instrument" required><Select value={form.instrument} onChange={(v) => setForm((f) => ({ ...f, instrument: v }))} options={["Equity", "SAFE", "Convertible", "Other"]} /></Field>
              <Field label="Amount (USD)" required><input type="number" min={1} style={inputStyle} value={form.amount} onChange={set("amount")} required /></Field>
            </Row>
            <Row>
              <Field label="Stake %"><input type="number" step="0.001" min={0} max={100} style={inputStyle} value={form.stake_pct} onChange={set("stake_pct")} /></Field>
              <Field label="Valuation (USD)"><input type="number" min={1} style={inputStyle} value={form.valuation} onChange={set("valuation")} /></Field>
            </Row>
            <Field label="Notes"><input style={inputStyle} value={form.notes} onChange={set("notes")} /></Field>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <GhostButton onClick={() => setShowNew(false)}>Cancel</GhostButton>
              <PrimaryButton type="submit">Propose</PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
      {fund && <PayModal title={`Fund ${fund.startup_name}`} summary={<>Pay <strong>{usd(fund.amount)}</strong> from the Retail X HoldCo account.</>} refLabel="Bank reference"
        onClose={() => setFund(null)}
        onSubmit={async (file, value_date, bank_reference) => { await api.fundOutbound(fund.id, file, { value_date, bank_reference }); setFund(null); showSuccess("Investment funded."); load(); }} />}
      {docsFor && <Modal title={`${docsFor.startup_name}: documents`} onClose={() => setDocsFor(null)} width={760}><DocumentsPanel linkedType="outbound" linkedId={docsFor.id} /></Modal>}
    </div>
  );
}

export function AdminMoneyView({ currentUser }) {
  const [tab, setTab] = useState("payouts");
  return (
    <div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "payouts", label: "Partner payouts" }, { id: "movements", label: "Money in and out" }, { id: "outbound", label: "RIV's investments" }]} />
      {tab === "payouts" && <PayoutsTab currentUser={currentUser} />}
      {tab === "movements" && <MovementsTab />}
      {tab === "outbound" && <OutboundTab />}
    </div>
  );
}
