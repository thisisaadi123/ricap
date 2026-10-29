// IB deals (Capital Advisory, PRD 6.8): deal setup with the floor rules
// (BIZ-3), mandate, going live, investors, fee invoices with VAT (LEG-11)
// and RIV's total consideration including sweat equity (VP-1).
import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Circle, FileText, Plus, Rocket } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { COMMITMENT_STATUS_COLORS, stageLabel } from "../../constants.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateStr, dateTimeStr, inputStyle, usd, useSuccessMessage,
} from "../../components/ui.jsx";
import { DocLink, FileButton, KeyValues, Muted, Row, SectionTitle, Select, Tabs } from "../../components/forms.jsx";
import { DocumentsPanel } from "../../components/DocumentsPanel.jsx";

const DEAL_COLORS = {
  Sourced: { bg: "#F3F1EE", fg: "#8A857F" }, "Mandate signed": { bg: "#E8F0FE", fg: BRAND.blue }, Live: { bg: "#E6F4EA", fg: "#1E7A34" },
  Closed: { bg: "#EFE9FB", fg: "#6B3FBF" }, Withdrawn: { bg: "#FBEAEA", fg: BRAND.coralDark },
};
const INVOICE_COLORS = { Draft: { bg: "#F3F1EE", fg: "#8A857F" }, Sent: { bg: "#FFF4E0", fg: "#B8790A" }, Paid: { bg: "#E6F4EA", fg: "#1E7A34" }, Void: { bg: "#F3F1EE", fg: "#8A857F" } };
const EMPTY = {
  name: "", startup_name: "", rise_startup_id: "", sector: "", instrument: "Equity", round_size: "", pre_money_valuation: "", riv_allocation: "",
  fee_pct: 5, sweat_equity_pct: 0, exclusivity: false, term_start: "", term_end: "", below_floor_reason: "", data_room_url: "",
  startup_contact_name: "", startup_contact_email: "", summary: "",
};

// Live warnings while typing, mirroring the server's floor rules (BIZ-3).
function floorHints(f) {
  const size = Number(f.round_size);
  if (!size) return [];
  const hints = [];
  if (size < 2000000 && !(Number(f.sweat_equity_pct) > 0)) hints.push("Under USD 2M: RIV must also take sweat equity.");
  if (size < 500000 && !f.below_floor_reason) hints.push("Under the USD 500K floor: record the reason.");
  return hints;
}

function toForm(d) {
  const f = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) if (d[k] !== null && d[k] !== undefined) f[k] = d[k];
  for (const k of ["term_start", "term_end"]) f[k] = d[k] ? String(d[k]).slice(0, 10) : "";
  return f;
}

function payload(f) {
  const blank = (x) => (x === "" ? null : x);
  const out = { ...f };
  if (!out.name) delete out.name; // the server names it after the startup
  return { ...out, rise_startup_id: blank(f.rise_startup_id), riv_allocation: blank(f.riv_allocation), term_start: blank(f.term_start), term_end: blank(f.term_end), below_floor_reason: blank(f.below_floor_reason), data_room_url: blank(f.data_room_url), startup_contact_email: blank(f.startup_contact_email) };
}

function DealForm({ form, setForm, disabled }) {
  const set = (k) => (val) => setForm((f) => ({ ...f, [k]: val }));
  const input = (k, props = {}) => <input style={inputStyle} value={form[k] ?? ""} disabled={disabled} onChange={(e) => set(k)(e.target.value)} {...props} />;
  const sweatValue = (Number(form.sweat_equity_pct) / 100) * Number(form.pre_money_valuation || 0);
  const hints = floorHints(form);
  return (
    <>
      <Row>
        <Field label="Startup" required>{input("startup_name", { required: true })}</Field>
        <Field label="Deal name" hint="Defaults to the startup and instrument.">{input("name")}</Field>
      </Row>
      <Row>
        <Field label="Sector">{input("sector")}</Field>
        <Field label="RISE startup ID" hint="Reference only (IB-1).">{input("rise_startup_id")}</Field>
        <Field label="Instrument" required><Select value={form.instrument} onChange={set("instrument")} options={["Equity", "SAFE", "Convertible", "Other"]} disabled={disabled} /></Field>
      </Row>
      <Row>
        <Field label="Round size (USD)" required>{input("round_size", { type: "number", min: 1, required: true })}</Field>
        <Field label="Pre-money valuation (USD)" required>{input("pre_money_valuation", { type: "number", min: 1, required: true })}</Field>
        <Field label="Allocation for RIV's investors (USD)">{input("riv_allocation", { type: "number", min: 1 })}</Field>
      </Row>
      <Row>
        <Field label="Cash fee %" hint="Of capital placed, paid by the startup.">{input("fee_pct", { type: "number", step: "0.01", min: 0, max: 100 })}</Field>
        <Field label="Sweat equity %" hint={sweatValue ? `Worth ${usd(sweatValue)} at pre-money.` : "Stake RIV takes in the startup."}>{input("sweat_equity_pct", { type: "number", step: "0.001", min: 0, max: 100 })}</Field>
      </Row>
      {hints.length > 0 && <div style={{ fontSize: 12, color: "#B8790A", marginBottom: 12 }}>{hints.join(" ")}</div>}
      {Number(form.round_size) > 0 && Number(form.round_size) < 500000 && (
        <Field label="Why go below the USD 500K floor?" required><input style={inputStyle} value={form.below_floor_reason ?? ""} disabled={disabled} onChange={(e) => set("below_floor_reason")(e.target.value)} /></Field>
      )}
      <Row>
        <Field label="Mandate start">{input("term_start", { type: "date" })}</Field>
        <Field label="Mandate end">{input("term_end", { type: "date" })}</Field>
        <Field label="Exclusive mandate">
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, paddingTop: 10 }}><input type="checkbox" checked={form.exclusivity} disabled={disabled} onChange={(e) => set("exclusivity")(e.target.checked)} /> Exclusive</label>
        </Field>
      </Row>
      <Row>
        <Field label="Startup contact">{input("startup_contact_name")}</Field>
        <Field label="Startup contact email" hint="Invoices go here.">{input("startup_contact_email", { type: "email" })}</Field>
      </Row>
      <Field label="Data room link" hint="External data room (IB-3); https only.">{input("data_room_url", { placeholder: "https://" })}</Field>
      <Field label="Teaser summary" hint="Shown to partners and investors once the deal is live. Factual, not advice."><textarea style={{ ...inputStyle, minHeight: 70 }} value={form.summary ?? ""} disabled={disabled} onChange={(e) => set("summary")(e.target.value)} /></Field>
    </>
  );
}

function NewDealModal({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try { const { deal } = await api.createDeal(payload(form)); onCreated(deal.vehicle_id); } catch (err) { setError(err.message); setSaving(false); }
  }
  return (
    <Modal title="New IB deal" onClose={onClose} width={760}>
      <form onSubmit={submit}>
        <ErrorBanner text={error} />
        <DealForm form={form} setForm={setForm} />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Create deal"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function DealNextStep({ data, run, setError }) {
  const d = data.deal;
  const [mandateDate, setMandateDate] = useState(d.mandate_signed_date ? String(d.mandate_signed_date).slice(0, 10) : "");
  const next = data.next_stage;
  if (!next) return null;
  return (
    <Card style={{ padding: 16, marginBottom: 16, borderColor: BRAND.coral }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Next: {next}</div>
      {data.next_evidence.map((e) => (
        <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${BRAND.line}`, fontSize: 12.5 }}>
          {e.met ? <Check size={14} color="#1E7A34" /> : <Circle size={12} color={MUTED} />}
          <div style={{ flex: 1 }}>{e.label}{e.documents.map((doc) => <div key={doc.id}><DocLink doc={doc} onError={setError} /></div>)}</div>
          <FileButton label={e.met ? "Add another" : "Upload"} onFile={(f) => run(() => api.uploadDocument(f, { linked_type: "vehicle", linked_id: d.vehicle_id, doc_type: e.doc_type, evidence_stage: next, title: e.label, signature_status: e.doc_type === "Engagement letter" ? "Fully executed" : "Not required" }), `${e.label} uploaded.`)} />
        </div>
      ))}
      {next === "Mandate signed" && (
        <Field label="Engagement letter signed on" style={{ marginTop: 12, maxWidth: 260 }}><input type="date" style={inputStyle} value={mandateDate} onChange={(e) => setMandateDate(e.target.value)} /></Field>
      )}
      {next === "Live" && !d.summary && <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>Also write the teaser summary in the deal details.</div>}
      {data.floor_problems.length > 0 && <div style={{ fontSize: 12, color: "#B8790A", marginTop: 10 }}>{data.floor_problems.join(" ")}</div>}
      <PrimaryButton icon={next === "Live" ? Rocket : undefined} style={{ marginTop: 12 }} onClick={() => run(() => api.advanceDeal(d.vehicle_id, { to_status: next, mandate_signed_date: mandateDate || undefined }), `Deal is now ${next}.`)}>Move to {next}</PrimaryButton>
    </Card>
  );
}

function InvoicesCard({ data, run, setError }) {
  const d = data.deal;
  const [due, setDue] = useState("");
  const [vat, setVat] = useState(5);
  const [payFor, setPayFor] = useState(null);
  const [pay, setPay] = useState({ amount: "", value_date: "", bank_reference: "" });
  const [file, setFile] = useState(null);
  const billable = data.commitments.filter((c) => ["Active", "On hold"].includes(c.status) && ["Funds transferred", "Closed"].includes(c.stage) && !c.invoice_id);
  const billableCapital = billable.reduce((s, c) => s + Number(c.funds_transferred_amount), 0);
  return (
    <>
      <SectionTitle>Fee invoices</SectionTitle>
      <Card style={{ padding: 16, marginBottom: 16 }}>
        {billable.length > 0 ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, marginBottom: 10 }}>{billable.length} confirmed placement{billable.length > 1 ? "s" : ""} not yet invoiced: {usd(billableCapital)} → fee {usd(billableCapital * Number(d.fee_pct) / 100)} + VAT</div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label="Due date" style={{ marginBottom: 0 }}><input type="date" style={inputStyle} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
              <Field label="VAT %" style={{ marginBottom: 0, width: 90 }}><input type="number" min={0} max={100} style={inputStyle} value={vat} onChange={(e) => setVat(e.target.value)} /></Field>
              <PrimaryButton icon={FileText} disabled={!due} onClick={() => run(() => api.createInvoice(d.vehicle_id, { due_date: due, vat_pct: vat }), "Invoice drafted.")}>Create invoice</PrimaryButton>
            </div>
          </div>
        ) : <div style={{ fontSize: 12.5, color: MUTED, marginBottom: data.invoices.length ? 14 : 0 }}>Invoices are raised once the startup confirms an investor's funds (stage Funds transferred).</div>}
        {data.invoices.map((f) => (
          <div key={f.id} style={{ padding: "10px 0", borderTop: `1px solid ${BRAND.line}`, fontSize: 12.5, opacity: f.status === "Void" ? 0.55 : 1 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{f.invoice_number}</strong>
              <StatusBadge status={f.overdue ? "Overdue" : f.status} colors={{ ...INVOICE_COLORS, Overdue: { bg: "#FBEAEA", fg: BRAND.coralDark } }} />
              <span>{usd(f.total)}</span>
              <Muted>fee {usd(f.fee_amount)} ({Number(f.fee_pct)}% of {usd(f.capital_placed)}) + VAT {usd(f.vat_amount)} · due {dateStr(f.due_date)} · to {f.billed_to}</Muted>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {f.status === "Draft" && <GhostButton style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => run(() => api.sendInvoice(f.id), "Marked as sent.")}>Mark sent</GhostButton>}
                {f.status === "Sent" && <GhostButton style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => { setPayFor(f.id); setPay({ amount: f.total, value_date: "", bank_reference: "" }); }}>Record payment</GhostButton>}
                {["Draft", "Sent"].includes(f.status) && <GhostButton style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => { const reason = window.prompt("Why void this invoice? Its placements can be invoiced again."); if (reason) run(() => api.voidInvoice(f.id, reason), "Invoice voided."); }}>Void</GhostButton>}
              </div>
            </div>
            {f.status === "Void" && <Muted>Voided: {f.void_reason}</Muted>}
            {f.status === "Paid" && <Muted>Paid {dateTimeStr(f.paid_at)}</Muted>}
            {payFor === f.id && (
              <div style={{ marginTop: 10, padding: 12, background: BRAND.cream, borderRadius: 10 }}>
                <Row>
                  <Field label="Amount (USD)"><input type="number" style={inputStyle} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
                  <Field label="Value date"><input type="date" style={inputStyle} value={pay.value_date} onChange={(e) => setPay({ ...pay, value_date: e.target.value })} /></Field>
                  <Field label="Bank reference"><input style={inputStyle} value={pay.bank_reference} onChange={(e) => setPay({ ...pay, bank_reference: e.target.value })} /></Field>
                </Row>
                <Field label="Bank proof"><input type="file" style={inputStyle} accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
                <div style={{ display: "flex", gap: 8 }}>
                  <PrimaryButton disabled={!file} onClick={async () => { if (await run(() => api.recordInvoicePayment(f.id, file, pay), "Fee payment recorded.")) { setPayFor(null); setFile(null); } }}>Save payment</PrimaryButton>
                  <GhostButton onClick={() => setPayFor(null)}>Cancel</GhostButton>
                </div>
              </div>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}

function DealWorkspace({ dealId, onBack, onOpenCommitment }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const load = useCallback(() => { api.getDeal(dealId).then((r) => { setData(r); setForm(toForm({ ...r.deal })); }).catch((e) => setError(e.message)); }, [dealId]);
  useEffect(load, [load]);
  async function run(fn, msg) {
    setError("");
    try { await fn(); if (msg) showSuccess(msg); load(); return true; } catch (e) { setError(e.message); load(); return false; }
  }
  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const d = data.deal;
  const k = data.consideration;
  const closed = ["Closed", "Withdrawn"].includes(d.deal_status);

  return (
    <div>
      <GhostButton icon={ArrowLeft} onClick={onBack} style={{ marginBottom: 14, padding: "7px 12px" }}>All IB deals</GhostButton>
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18 }}>{d.name}</div>
          <StatusBadge status={d.deal_status} colors={DEAL_COLORS} />
          {!closed && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {d.deal_status === "Live" && <GhostButton onClick={() => { const reason = window.prompt("Close the deal: reason (e.g. round fully subscribed). Investors who haven't transferred funds will be withdrawn."); if (reason) run(() => api.closeDeal(d.vehicle_id, "Closed", reason), "Deal closed."); }}>Close deal</GhostButton>}
              <GhostButton onClick={() => { const reason = window.prompt("Withdraw the deal: reason. Investors who haven't transferred funds will be withdrawn."); if (reason) run(() => api.closeDeal(d.vehicle_id, "Withdrawn", reason), "Deal withdrawn."); }}>Withdraw</GhostButton>
            </div>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>
          {d.startup_name} · {d.instrument} · round {usd(d.round_size)} at {usd(d.pre_money_valuation)} pre-money · fee {Number(d.fee_pct)}%{Number(d.sweat_equity_pct) > 0 ? ` + ${Number(d.sweat_equity_pct)}% sweat equity` : ""} · money goes {d.funds_route.toLowerCase()}
          {d.close_reason && <div>{d.deal_status}: {d.close_reason}</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginTop: 14 }}>
          {[["Capital placed", usd(k.capital_placed)], ["Cash fee on it", usd(k.cash_fee)], ["Sweat equity value", usd(k.sweat_equity_value)], ["RIV total consideration", usd(k.total)], ["Fees invoiced", usd(d.fees_invoiced)], ["Fees received", usd(d.fees_received)]].map(([l, val]) => (
            <div key={l}><Muted>{l}</Muted><div style={{ fontWeight: 700, fontSize: 15 }}>{val}</div></div>
          ))}
        </div>
      </Card>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "overview", label: "Next steps & investors", count: data.commitments.length }, { id: "details", label: "Deal details" }, { id: "documents", label: "Documents" }, { id: "access", label: "Data-room log", count: data.access_log.length || undefined }]} />
      {tab === "overview" && (
        <>
          <DealNextStep key={d.deal_status} data={data} run={run} setError={setError} />
          <SectionTitle>Investors</SectionTitle>
          {data.commitments.length ? (
            <DataTable columns={["Investor", "Stage", "Amount", "Startup confirmed", "Invoiced"]}>
              {data.commitments.map((c) => (
                <tr key={c.id} onClick={() => onOpenCommitment(c.id)} style={{ cursor: "pointer" }}>
                  <td style={cellStyle}><div style={{ fontWeight: 600 }}>{c.investor_name}</div>{c.partner_name && <Muted>{c.partner_name}</Muted>}</td>
                  <td style={cellStyle}>{stageLabel("IB", c.stage)}{c.status !== "Active" && <div><StatusBadge status={c.status} colors={COMMITMENT_STATUS_COLORS} /></div>}{c.data_room_granted_at && <div><Muted>data room ✓</Muted></div>}</td>
                  <td style={cellStyle}>{usd(c.committed_amount || c.indicative_amount)}</td>
                  <td style={cellStyle}>{c.funds_transferred_amount ? `${usd(c.funds_transferred_amount)} · ${dateStr(c.funds_transferred_date)}` : <Muted>—</Muted>}</td>
                  <td style={cellStyle}>{c.invoice_id ? "Yes" : <Muted>—</Muted>}</td>
                </tr>
              ))}
            </DataTable>
          ) : <Card style={{ padding: 16 }}><Muted>No investors yet. {d.deal_status === "Live" ? "Investors and partners can see this deal now; you can also add one on the Commitments page." : "Investors can join once the deal is live."}</Muted></Card>}
          <InvoicesCard data={data} run={run} setError={setError} />
        </>
      )}
      {tab === "details" && (
        <form onSubmit={(e) => { e.preventDefault(); run(() => api.updateDeal(d.vehicle_id, payload(form)), "Deal saved."); }}>
          <DealForm form={form} setForm={setForm} disabled={closed} />
          {!closed && <div style={{ display: "flex", justifyContent: "flex-end" }}><PrimaryButton type="submit">Save deal</PrimaryButton></div>}
        </form>
      )}
      {tab === "documents" && (
        <>
          <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>Teasers are shown to partners and investors once the deal is live. Everything else stays with the RIV team.</div>
          <DocumentsPanel linkedType="vehicle" linkedId={d.vehicle_id} />
        </>
      )}
      {tab === "access" && (data.access_log.length ? (
        <DataTable columns={["When", "Investor", "Action", "By"]}>
          {data.access_log.map((a) => (
            <tr key={a.id}><td style={cellStyle}>{dateTimeStr(a.created_at)}</td><td style={cellStyle}>{a.investor_name}</td><td style={cellStyle}>{a.action}</td><td style={cellStyle}>{a.actor_name}</td></tr>
          ))}
        </DataTable>
      ) : <Card style={{ padding: 16 }}><Muted>No data-room access granted yet.</Muted></Card>)}
    </div>
  );
}

export function AdminDealsView({ openId, setOpenId, onOpenCommitment }) {
  const [deals, setDeals] = useState(null);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const load = useCallback(() => { api.listDeals().then((r) => setDeals(r.deals)).catch((e) => setError(e.message)); }, []);
  useEffect(() => { if (!openId) load(); }, [load, openId]);
  if (openId) return <DealWorkspace dealId={openId} onBack={() => setOpenId(null)} onOpenCommitment={onOpenCommitment} />;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <PrimaryButton icon={Plus} onClick={() => setShowNew(true)}>New IB deal</PrimaryButton>
      </div>
      <ErrorBanner text={error} />
      {!deals ? <Spinner /> : !deals.length ? (
        <EmptyState icon={Rocket} title="No IB deals yet" text="Create a deal when a startup gives RIV a mandate to raise. Rounds of USD 2M+ are preferred (BIZ-3)." />
      ) : (
        <DataTable columns={["Deal", "Status", "Round", "Investors", "Capital placed", "Fees invoiced / received"]}>
          {deals.map((d) => (
            <tr key={d.vehicle_id} onClick={() => setOpenId(d.vehicle_id)} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><div style={{ fontWeight: 600 }}>{d.name}</div><Muted>{d.startup_name}{d.sector ? ` · ${d.sector}` : ""}</Muted></td>
              <td style={cellStyle}><StatusBadge status={d.deal_status} colors={DEAL_COLORS} /></td>
              <td style={cellStyle}>{usd(d.round_size)}<div><Muted>{d.instrument} · {Number(d.fee_pct)}%{Number(d.sweat_equity_pct) > 0 ? ` + ${Number(d.sweat_equity_pct)}% sweat` : ""}</Muted></div></td>
              <td style={cellStyle}>{d.live_count}</td>
              <td style={cellStyle}>{usd(d.capital_placed)}</td>
              <td style={cellStyle}>{usd(d.fees_invoiced)} / {usd(d.fees_received)}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {showNew && <NewDealModal onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); setOpenId(id); }} />}
    </div>
  );
}
