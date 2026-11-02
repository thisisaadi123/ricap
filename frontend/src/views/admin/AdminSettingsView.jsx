// Settings: everything an admin configures rather than works in day to day.
import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, MUTED } from "../../brand.js";
import { DOC_TYPES, FLOWS } from "../../constants.js";
import { Card, ErrorBanner, Field, GhostButton, Spinner, SuccessBanner, inputStyle, useSuccessMessage } from "../../components/ui.jsx";
import { Muted, Row, Select, Tabs } from "../../components/forms.jsx";
import { AdminTemplatesView } from "./AdminTemplatesView.jsx";
import { AdminImportView } from "./AdminImportView.jsx";
import { AdminUsersView } from "./AdminUsersView.jsx";
import { AuditLogView } from "./AuditLogView.jsx";

// Stages that can carry evidence, per flow (Intent and Eligible never do).
const EVIDENCE_STAGES = {
  HoldCo: FLOWS.HoldCo.slice(2),
  Fund: FLOWS.Fund.slice(2),
  IB: FLOWS.IB.slice(2),
  "IB deal": ["Mandate signed", "Live"],
};
const FLOW_LABELS = { HoldCo: "HoldCo commitments", Fund: "Fund commitments", IB: "IB deal investors", "IB deal": "IB deals" };

function StageEvidenceView() {
  const [reqs, setReqs] = useState(null);
  const [flow, setFlow] = useState("HoldCo");
  const [draft, setDraft] = useState({ stage: "", label: "", doc_type: "Other" });
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const load = useCallback(() => { api.listStageRequirements().then((r) => setReqs(r.requirements)).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);

  async function run(fn, msg) {
    setError("");
    try { await fn(); showSuccess(msg); load(); return true; } catch (e) { setError(e.message); return false; }
  }
  if (!reqs) return error ? <ErrorBanner text={error} /> : <Spinner />;

  return (
    <div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12, lineHeight: 1.6 }}>
        The documents a commitment needs before it can move into each stage (PRD 7). Unticked items are suggested but not required. Changes apply straight away.
      </div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <Tabs value={flow} onChange={setFlow} tabs={Object.keys(EVIDENCE_STAGES).map((f) => ({ id: f, label: FLOW_LABELS[f] }))} />
      {EVIDENCE_STAGES[flow].map((stage) => {
        const items = reqs.filter((r) => r.flow === flow && r.stage === stage);
        return (
          <Card key={stage} style={{ padding: 14, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: items.length ? 8 : 0 }}>{stage}</div>
            {items.length ? items.map((r) => (
              <label key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, padding: "4px 0" }}>
                <input type="checkbox" checked={r.required} onChange={() => run(() => api.setStageRequirementRequired(r.id, !r.required), r.required ? "Now optional." : "Now required.")} />
                {r.label} <Muted>({r.doc_type})</Muted>
              </label>
            )) : <Muted>No documents needed.</Muted>}
          </Card>
        );
      })}
      <Card style={{ padding: 16, marginTop: 14, borderStyle: "dashed", borderColor: BRAND.line }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Add a required document to {FLOW_LABELS[flow].toLowerCase()}</div>
        <Row>
          <Field label="Stage"><Select value={draft.stage} onChange={(v) => setDraft({ ...draft, stage: v })} placeholder="Choose…" options={EVIDENCE_STAGES[flow]} /></Field>
          <Field label="What's needed"><input style={inputStyle} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
          <Field label="Document type"><Select value={draft.doc_type} onChange={(v) => setDraft({ ...draft, doc_type: v })} options={DOC_TYPES.filter((t) => t !== "KYC document")} /></Field>
        </Row>
        <GhostButton icon={Plus} disabled={!draft.stage || !draft.label} onClick={async () => { if (await run(() => api.addStageRequirement({ ...draft, flow }), "Requirement added.")) setDraft({ stage: "", label: "", doc_type: "Other" }); }}>Add</GhostButton>
      </Card>
    </div>
  );
}

function PayoutRulesView() {
  const [value, setValue] = useState(null);
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  useEffect(() => { api.getMoneySettings().then((r) => setValue(r.payout_second_admin_above)).catch((e) => setError(e.message)); }, []);
  if (value === null) return error ? <ErrorBanner text={error} /> : <Spinner />;
  return (
    <Card style={{ padding: 18, maxWidth: 520 }}>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <Field label="Second admin needed for payouts above (USD)" hint="Total including VAT. Every payout needs one admin; above this, two different admins (PRD 9.2).">
        <input type="number" min={0} style={inputStyle} value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <GhostButton onClick={async () => { setError(""); try { await api.updateMoneySettings({ payout_second_admin_above: value }); showSuccess("Saved."); } catch (e) { setError(e.message); } }}>Save</GhostButton>
    </Card>
  );
}

export function AdminSettingsView({ currentUser }) {
  const [tab, setTab] = useState("templates");
  return (
    <div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "templates", label: "KYC & agreement templates" }, { id: "evidence", label: "Stage evidence" }, { id: "payouts", label: "Payout rules" },
        { id: "import", label: "Bigin import" }, { id: "users", label: "Users" }, { id: "audit", label: "Audit log" },
      ]} />
      {tab === "templates" && <AdminTemplatesView />}
      {tab === "evidence" && <StageEvidenceView />}
      {tab === "payouts" && <PayoutRulesView />}
      {tab === "import" && <AdminImportView />}
      {tab === "users" && <AdminUsersView currentUser={currentUser} />}
      {tab === "audit" && <AuditLogView />}
    </div>
  );
}
