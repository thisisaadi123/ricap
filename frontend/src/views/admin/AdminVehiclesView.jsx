// HoldCo and Fund vehicles (PRD 8.4): capital against target, settings,
// receiving bank account with two-admin approval (PRD 7), per-investor
// visibility (PRD 6.14) and teasers.
import React, { useCallback, useEffect, useState } from "react";
import { Landmark, ShieldAlert } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { BANK_CHANGE_COLORS, CLASSIFICATIONS, VEHICLE_STATUSES, VEHICLE_STATUS_COLORS } from "../../constants.js";
import {
  Card, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  dateTimeStr, inputStyle, usd, useSuccessMessage,
} from "../../components/ui.jsx";
import { CheckboxChips, KeyValues, Muted, Row, SectionTitle, Select, Tabs } from "../../components/forms.jsx";
import { CapitalBar } from "../../components/progress.jsx";
import { DocumentsPanel } from "../../components/DocumentsPanel.jsx";

export function vehicleCapitalParts(v) {
  return v.type === "Fund"
    ? [["Soft-confirmed", v.soft_confirmed_total, "#1E7A34"], ["Indicated", Math.max(0, Number(v.indicative_total) - Number(v.soft_confirmed_total)), "#F3C27A"]]
    : [["Received", v.received_total, "#1E7A34"], ["Committed, not yet received", Math.max(0, Number(v.committed_total) - Number(v.received_total)), BRAND.blue]];
}

function SettingsTab({ vehicle, onSaved, setError }) {
  const [form, setForm] = useState({
    name: vehicle.name, status: vehicle.status, target_raise: vehicle.target_raise ?? "", pre_money_valuation: vehicle.pre_money_valuation ?? "",
    min_ticket_individual: vehicle.min_ticket_individual ?? "", min_ticket_entity: vehicle.min_ticket_entity ?? "",
    eligible_classifications: vehicle.eligible_classifications || [], summary: vehicle.summary || "",
    visible_to_partners: vehicle.visible_to_partners, visible_to_investors: vehicle.visible_to_investors,
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (val) => setForm((f) => ({ ...f, [k]: val }));
  const num = (k) => <input type="number" min={0} style={inputStyle} value={form[k]} onChange={(e) => set(k)(e.target.value)} />;

  async function save(e) {
    e.preventDefault();
    setSaving(true); setError("");
    const blank = (x) => (x === "" ? null : x);
    try {
      await api.updateVehicle(vehicle.id, { ...form, target_raise: blank(form.target_raise), pre_money_valuation: blank(form.pre_money_valuation), min_ticket_individual: blank(form.min_ticket_individual), min_ticket_entity: blank(form.min_ticket_entity) });
      onSaved("Vehicle saved.");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={save}>
      <Row>
        <Field label="Name" required><input style={inputStyle} value={form.name} onChange={(e) => set("name")(e.target.value)} required /></Field>
        <Field label="Status" hint="Only Open vehicles take new commitments."><Select value={form.status} onChange={set("status")} options={VEHICLE_STATUSES} /></Field>
      </Row>
      <Row>
        <Field label="Target raise (USD)">{num("target_raise")}</Field>
        {vehicle.type === "HoldCo" ? <Field label="Pre-money valuation (USD)">{num("pre_money_valuation")}</Field> : <div />}
      </Row>
      <Row>
        <Field label="Minimum ticket, individuals (USD)" hint="Blank = no minimum.">{num("min_ticket_individual")}</Field>
        <Field label="Minimum ticket, entities (USD)" hint="Blank = no minimum.">{num("min_ticket_entity")}</Field>
      </Row>
      <Field label="Only these KYC classifications may invest" hint="None ticked = any classification."><CheckboxChips options={CLASSIFICATIONS} value={form.eligible_classifications} onChange={set("eligible_classifications")} /></Field>
      <Field label="Summary shown to partners and investors"><textarea style={{ ...inputStyle, minHeight: 70 }} value={form.summary} onChange={(e) => set("summary")(e.target.value)} /></Field>
      <div style={{ display: "flex", gap: 20, marginBottom: 16, fontSize: 12.5 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={form.visible_to_partners} onChange={(e) => set("visible_to_partners")(e.target.checked)} /> Visible to venture partners</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={form.visible_to_investors} onChange={(e) => set("visible_to_investors")(e.target.checked)} /> Visible to investors</label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><PrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save settings"}</PrimaryButton></div>
    </form>
  );
}

function BankTab({ data, currentUser, reload, setError, showSuccess }) {
  const { vehicle, bank_changes: changes } = data;
  const pending = changes.find((c) => c.status === "Pending");
  const [form, setForm] = useState({ bank_name: "", bank_account_name: "", bank_iban: "", bank_swift: "", reason: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function run(fn, msg) {
    setError("");
    try { await fn(); showSuccess(msg); reload(); return true; } catch (e) { setError(e.message); return false; }
  }

  return (
    <div>
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Current receiving account</div>
        {vehicle.bank_approved_at ? (
          <KeyValues rows={[["Legal entity", vehicle.legal_entity], ["Bank", vehicle.bank_name], ["Account name", vehicle.bank_account_name], ["IBAN", vehicle.bank_iban], ["SWIFT / BIC", vehicle.bank_swift], ["Approved", dateTimeStr(vehicle.bank_approved_at)]]} />
        ) : <Muted>No approved account yet. Payment instructions can't be issued until one is approved.</Muted>}
      </Card>
      {pending ? (
        <Card style={{ padding: 16, marginBottom: 16, borderColor: "#F3D9A4", background: "#FFFBF2" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, fontSize: 13, marginBottom: 10 }}><ShieldAlert size={15} color="#B8790A" /> Change waiting for a second admin</div>
          <KeyValues rows={[["Bank", pending.bank_name], ["Account name", pending.bank_account_name], ["IBAN", pending.bank_iban], ["SWIFT / BIC", pending.bank_swift], ["Reason", pending.reason], ["Proposed by", `${pending.proposed_by_name}, ${dateTimeStr(pending.proposed_at)}`]]} />
          <div style={{ fontSize: 12, color: MUTED, margin: "12px 0" }}>Check every character against the bank's letter before approving. Fraudsters change bank details.</div>
          <div style={{ display: "flex", gap: 8 }}>
            {pending.proposed_by !== currentUser.id ? (
              <>
                <PrimaryButton onClick={async () => { let n = 0; await run(async () => { n = (await api.decideBankChange(pending.id, "approve")).instructions_to_reissue; }, "Account approved and now in use."); if (n) showSuccess(`Account approved. ${n} set${n === 1 ? "" : "s"} of live payment instructions still show the old account: void and reissue them.`); }}>Approve</PrimaryButton>
                <GhostButton onClick={() => { const note = window.prompt("Why reject?"); if (note !== null) run(() => api.decideBankChange(pending.id, "reject", note), "Change rejected."); }}>Reject</GhostButton>
              </>
            ) : (
              <>
                <Muted style={{ alignSelf: "center" }}>You proposed this; another admin must approve it.</Muted>
                <GhostButton onClick={() => run(() => api.decideBankChange(pending.id, "cancel"), "Change cancelled.")}>Cancel my proposal</GhostButton>
              </>
            )}
          </div>
        </Card>
      ) : (
        <Card style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{vehicle.bank_approved_at ? "Propose a change" : "Propose the receiving account"}</div>
          <Row>
            <Field label="Bank" required><input style={inputStyle} value={form.bank_name} onChange={set("bank_name")} /></Field>
            <Field label="Account name" required><input style={inputStyle} value={form.bank_account_name} onChange={set("bank_account_name")} /></Field>
          </Row>
          <Row>
            <Field label="IBAN" required><input style={inputStyle} value={form.bank_iban} onChange={set("bank_iban")} placeholder="AE07 0331 2345 6789 0123 456" /></Field>
            <Field label="SWIFT / BIC" required><input style={inputStyle} value={form.bank_swift} onChange={set("bank_swift")} /></Field>
          </Row>
          <Field label="Reason"><input style={inputStyle} value={form.reason} onChange={set("reason")} /></Field>
          <PrimaryButton onClick={async () => { if (await run(() => api.proposeBankChange(vehicle.id, form), "Proposed. A second admin must approve it.")) setForm({ bank_name: "", bank_account_name: "", bank_iban: "", bank_swift: "", reason: "" }); }}>Propose</PrimaryButton>
        </Card>
      )}
      {changes.filter((c) => c.status !== "Pending").length > 0 && (
        <>
          <SectionTitle>History</SectionTitle>
          {changes.filter((c) => c.status !== "Pending").map((c) => (
            <div key={c.id} style={{ fontSize: 12.5, padding: "8px 0", borderBottom: `1px solid ${BRAND.line}` }}>
              <StatusBadge status={c.status} colors={BANK_CHANGE_COLORS} /> {c.bank_name} · {c.bank_iban}
              <div><Muted>Proposed by {c.proposed_by_name} {dateTimeStr(c.proposed_at)}{c.decided_by_name ? ` · ${c.status.toLowerCase()} by ${c.decided_by_name} ${dateTimeStr(c.decided_at)}` : ""}{c.decision_note ? ` · ${c.decision_note}` : ""}</Muted></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function VisibilityTab({ data, reload, setError, showSuccess }) {
  const [investors, setInvestors] = useState([]);
  const [pick, setPick] = useState("");
  useEffect(() => { api.listInvestors({ status: "Approved" }).then((r) => setInvestors(r.investors)).catch(() => {}); }, []);
  const hiddenIds = data.hidden_investors.map((h) => h.investor_id);

  async function run(fn, msg) {
    setError("");
    try { await fn(); showSuccess(msg); reload(); } catch (e) { setError(e.message); }
  }

  return (
    <div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14, lineHeight: 1.6 }}>
        Investors see open vehicles by default (INV-7). Hide this one from specific investors here, for example while Novo Juris confirms DFSA financial-promotion rules.
      </div>
      {data.hidden_investors.length ? data.hidden_investors.map((h) => (
        <div key={h.investor_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${BRAND.line}`, fontSize: 13 }}>
          <strong>{h.investor_name}</strong> <Muted>hidden by {h.hidden_by_name}</Muted>
          <GhostButton style={{ marginLeft: "auto", padding: "6px 10px", fontSize: 12 }} onClick={() => run(() => api.unhideVehicle(data.vehicle.id, h.investor_id), `Visible to ${h.investor_name} again.`)}>Show again</GhostButton>
        </div>
      )) : <Muted>Not hidden from anyone.</Muted>}
      <div style={{ display: "flex", gap: 8, marginTop: 14, maxWidth: 520 }}>
        <Select value={pick} onChange={setPick} placeholder="Choose an investor…" options={investors.filter((i) => !hiddenIds.includes(i.id)).map((i) => ({ value: i.id, label: i.display_name || i.legal_name }))} />
        <GhostButton disabled={!pick} onClick={() => run(() => api.hideVehicle(data.vehicle.id, Number(pick)), "Hidden from that investor.").then(() => setPick(""))}>Hide</GhostButton>
      </div>
    </div>
  );
}

function VehicleModal({ vehicleId, currentUser, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("settings");
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const load = useCallback(() => { api.getVehicle(vehicleId).then(setData).catch((e) => setError(e.message)); }, [vehicleId]);
  useEffect(load, [load]);
  if (!data) return <Modal title="Vehicle" onClose={onClose} width={760}>{error ? <ErrorBanner text={error} /> : <Spinner />}</Modal>;
  const v = data.vehicle;
  return (
    <Modal title={v.name} onClose={onClose} width={760}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <StatusBadge status={v.status} colors={VEHICLE_STATUS_COLORS} /><Muted>{v.type} · {v.legal_entity} · {v.jurisdiction}</Muted>
      </div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <Tabs value={tab} onChange={(t) => { setTab(t); setError(""); }} tabs={[
        { id: "settings", label: "Settings" }, { id: "bank", label: "Receiving account" },
        { id: "visibility", label: "Visibility", count: data.hidden_investors.length || undefined }, { id: "documents", label: "Teaser & documents" },
      ]} />
      {tab === "settings" && <SettingsTab key={v.updated_at} vehicle={v} setError={setError} onSaved={(m) => { showSuccess(m); load(); onChanged(); }} />}
      {tab === "bank" && <BankTab data={data} currentUser={currentUser} reload={() => { load(); onChanged(); }} setError={setError} showSuccess={showSuccess} />}
      {tab === "visibility" && <VisibilityTab data={data} reload={load} setError={setError} showSuccess={showSuccess} />}
      {tab === "documents" && (
        <>
          <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>Documents of type "Teaser" are shown to partners and investors who can see this vehicle. Everything else stays with the RIV team.</div>
          <DocumentsPanel linkedType="vehicle" linkedId={v.id} />
        </>
      )}
    </Modal>
  );
}

export function AdminVehiclesView({ currentUser, onOpenCommitments }) {
  const [vehicles, setVehicles] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const load = useCallback(() => { api.listVehicles().then((r) => setVehicles(r.vehicles)).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  if (error) return <ErrorBanner text={error} />;
  if (!vehicles) return <Spinner />;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(420px, 100%), 1fr))", gap: 16 }}>
        {vehicles.map((v) => (
          <Card key={v.id} style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Landmark size={18} color={BRAND.coral} />
              <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16 }}>{v.name}</div>
              <StatusBadge status={v.status} colors={VEHICLE_STATUS_COLORS} />
            </div>
            <div style={{ fontSize: 12, color: MUTED, margin: "4px 0 16px" }}>{v.type} · {v.legal_entity}{v.pre_money_valuation ? ` · ${usd(v.pre_money_valuation)} pre-money` : ""}</div>
            <CapitalBar target={v.target_raise} parts={vehicleCapitalParts(v)} />
            <div style={{ display: "flex", gap: 16, fontSize: 12.5, margin: "16px 0", flexWrap: "wrap" }}>
              <span><strong>{v.live_count}</strong> live commitments</span>
              <span>Min ticket {v.min_ticket_individual ? usd(v.min_ticket_individual) : "none"} / {v.min_ticket_entity ? usd(v.min_ticket_entity) : "none"} <Muted>(individual / entity)</Muted></span>
              <span>{v.bank_approved_at ? <>Account <Muted>{v.bank_iban}</Muted></> : <span style={{ color: BRAND.coralDark }}>No receiving account</span>}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <PrimaryButton onClick={() => setOpenId(v.id)} style={{ padding: "8px 14px" }}>Manage</PrimaryButton>
              <GhostButton onClick={() => onOpenCommitments(v.id)}>Commitments</GhostButton>
            </div>
          </Card>
        ))}
      </div>
      {openId && <VehicleModal vehicleId={openId} currentUser={currentUser} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
