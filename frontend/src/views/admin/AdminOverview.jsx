// Admin home and its compliance and money views (PRD 6.11), plus the
// Intelligence headline view (PRD 6.12). Everything is worked out live.
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { KYC_COLORS, RISK_COLORS, stageLabel } from "../../constants.js";
import { Card, DataTable, ErrorBanner, Spinner, StatusBadge, cellStyle, dateStr, inputStyle, usd } from "../../components/ui.jsx";
import { Muted, Tabs } from "../../components/forms.jsx";
import { CapitalBar } from "../../components/progress.jsx";
import { vehicleCapitalParts } from "./AdminVehiclesView.jsx";
import { AuditLogView } from "./AuditLogView.jsx";

const FLOW_LABELS = { HoldCo: "HoldCo", Fund: "Fund", IB: "IB deals" };
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Tile({ label, value, sub, onClick, highlight }) {
  return (
    <Card onClick={onClick} style={{ padding: 18, cursor: onClick ? "pointer" : "default", borderColor: highlight ? "#F3D9A4" : BRAND.line, background: highlight ? "#FFFBF2" : "#fff" }}>
      <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 700, color: BRAND.ink, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontFamily: FONT, fontSize: 11.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
    </Card>
  );
}

function GroupTitle({ children }) {
  return <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, color: MUTED, margin: "24px 0 10px", textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</div>;
}

function Tiles({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))", gap: 14 }}>{children}</div>;
}

// Shown instead of a table when a queue is clear: an empty queue is good news.
function AllClear({ text }) {
  return <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "#1E7A34", padding: "10px 0" }}><CheckCircle2 size={15} /> {text}</div>;
}

function VehicleCapital({ v, onClick }) {
  const fund = v.type === "Fund";
  return (
    <Card onClick={onClick} style={{ padding: 18, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13.5 }}>{v.name}</strong>
        <Muted>{count(v.investors, "investor")} · {v.type === "IB Deal" ? v.deal_status : v.status}</Muted>
      </div>
      <CapitalBar target={v.target_raise} parts={vehicleCapitalParts(v)} />
      {!fund && <div style={{ fontSize: 12, marginTop: 8 }}>Committed {usd(v.committed_total)} · Outstanding <strong>{usd(v.outstanding_total)}</strong></div>}
    </Card>
  );
}

// One flow's pipeline. A single measure, so one colour and no legend; the
// count and amount sit beside each bar.
function Funnel({ flow, stages }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{FLOW_LABELS[flow]}</div>
      {stages.map((s) => (
        <div key={s.stage} title={`${stageLabel(flow, s.stage)}: ${count(s.count, "commitment")}, ${usd(s.amount)}`} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 40%) 1fr 22px", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 11.5 }}>
          <span style={{ color: s.count ? BRAND.ink : MUTED, lineHeight: 1.3 }}>{stageLabel(flow, s.stage)}</span>
          <span style={{ height: 8, background: "#F3F1EE", borderRadius: 4 }}>
            {s.count > 0 && <span style={{ display: "block", height: 8, width: `${(s.count / max) * 100}%`, minWidth: 4, background: BRAND.blue, borderRadius: 4 }} />}
          </span>
          <strong style={{ textAlign: "right", color: s.count ? BRAND.ink : MUTED }}>{s.count}</strong>
        </div>
      ))}
    </Card>
  );
}

function HomeTab({ onNavigate, onOpenLink }) {
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (days === "") return;
    api.dashboardHome(days).then((r) => { setData(r); setError(""); }).catch((e) => setError(e.message));
  }, [days]);
  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const { attention: a, kyc, fees, payouts, outbound, people, headline } = data;
  const main = data.vehicles.filter((v) => v.type !== "IB Deal");
  const deals = data.vehicles.filter((v) => v.type === "IB Deal" && (v.deal_status === "Live" || v.live_count > 0));
  const openCommitment = (id) => onOpenLink("commitments", id);

  return (
    <div>
      <ErrorBanner text={error} />
      <GroupTitle>Headline</GroupTitle>
      <Tiles>
        <Tile label="Investors with live commitments" value={headline.investors} sub={`${people.approved_investors} approved in total`} onClick={() => onNavigate("investors")} />
        <Tile label="Live IB deals" value={headline.live_deals} onClick={() => onNavigate("deals")} />
        <Tile label="Current commitments" value={usd(headline.current_commitments)} sub="Committed, or indicated where nothing is signed yet" onClick={() => onNavigate("commitments")} />
      </Tiles>

      <GroupTitle>Capital position</GroupTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(460px, 100%), 1fr))", gap: 14 }}>
        {main.map((v) => <VehicleCapital key={v.id} v={v} onClick={() => onNavigate("vehicles")} />)}
        {deals.map((v) => <VehicleCapital key={v.id} v={v} onClick={() => onNavigate("deals")} />)}
      </div>

      <GroupTitle>Needs attention</GroupTitle>
      <Tiles>
        <Tile label="Registrations to review" value={a.registrations} sub={`${a.pending_investors} investor${a.pending_investors === 1 ? "" : "s"}, ${a.pending_startups} startup${a.pending_startups === 1 ? "" : "s"}`} onClick={() => onNavigate(a.pending_investors > 0 || a.pending_startups === 0 ? "investors" : "referrals")} highlight={a.registrations > 0} />
        <Tile label="KYC waiting for review" value={kyc ? kyc.submitted : "–"} sub={kyc ? `${kyc.expiring} expiring soon, ${kyc.expired} expired` : "Needs restricted access"} onClick={() => onNavigate("kyc")} highlight={kyc && (kyc.submitted > 0 || kyc.expired > 0)} />
        <Tile label="Waiting on eligibility" value={a.waiting_eligibility} sub="KYC or minimum ticket" onClick={() => onNavigate("commitments")} highlight={a.waiting_eligibility > 0} />
        <Tile label="Payments due" value={a.funds_due} sub={`${data.overdue.length} overdue`} onClick={() => onNavigate("commitments")} highlight={data.overdue.length > 0} />
        <Tile label="Payouts to approve" value={payouts.to_approve} sub={usd(payouts.earned)} onClick={() => onNavigate("money")} highlight={payouts.to_approve > 0} />
        <Tile label="Money to reconcile" value={a.unreconciled} onClick={() => onNavigate("money")} />
        <Tile label="Partners still onboarding" value={people.onboarding_partners} sub={`${people.onboarded_partners} onboarded`} onClick={() => onNavigate("partners")} />
      </Tiles>

      {data.overdue.length > 0 && (
        <>
          <GroupTitle>Overdue payments</GroupTitle>
          <DataTable columns={["Investor", "Vehicle", "Outstanding", "Was due", "Overdue by"]}>
            {data.overdue.map((o) => (
              <tr key={o.commitment_id} onClick={() => openCommitment(o.commitment_id)} style={{ cursor: "pointer" }}>
                <td style={cellStyle}><strong>{o.investor_name}</strong></td>
                <td style={cellStyle}>{o.vehicle_name}</td>
                <td style={cellStyle}>{usd(o.outstanding)}</td>
                <td style={cellStyle}>{dateStr(o.due_date)}</td>
                <td style={cellStyle}>{count(o.days_overdue, "day")}</td>
              </tr>
            ))}
          </DataTable>
        </>
      )}

      <GroupTitle>Pipeline by stage</GroupTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: 14 }}>
        {Object.entries(data.funnel).map(([flow, stages]) => <Funnel key={flow} flow={flow} stages={stages} />)}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <GroupTitle>Stuck commitments</GroupTitle>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginTop: 14 }}>
          No stage change for more than
          <input type="number" min={0} max={3650} step={1} style={{ ...inputStyle, width: 76, padding: "6px 8px" }} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days" />
          days
        </label>
      </div>
      {!data.stuck.length ? <AllClear text="Nothing stuck." /> : (
        <DataTable columns={["Investor", "Vehicle", "Stage", "No change for"]}>
          {data.stuck.map((s) => (
            <tr key={s.id} onClick={() => openCommitment(s.id)} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><strong>{s.investor_name}</strong></td>
              <td style={cellStyle}>{s.vehicle_name}</td>
              <td style={cellStyle}>{stageLabel(s.flow, s.stage)}</td>
              <td style={cellStyle}>{count(s.days, "day")}</td>
            </tr>
          ))}
        </DataTable>
      )}

      <GroupTitle>Fees, payouts and RIV's investments</GroupTitle>
      <Tiles>
        <Tile label="Fees invoiced (excl. VAT)" value={usd(fees.invoiced)} sub={`${usd(fees.received)} received · ${usd(fees.overdue)} overdue`} onClick={() => onNavigate("deals")} />
        <Tile label="Payouts earned, not yet paid" value={usd(Number(payouts.earned) + Number(payouts.approved))} sub={`${usd(payouts.paid)} paid · ${usd(payouts.accruing)} accruing`} onClick={() => onNavigate("money")} />
        <Tile label="RIV's investments deployed" value={usd(outbound.deployed)} sub={`${count(outbound.held, "startup")} held · ${outbound.in_progress} in progress`} onClick={() => onNavigate("money")} />
      </Tiles>

      <GroupTitle>Partner leaderboard</GroupTitle>
      {!data.leaderboard.length ? <Muted>No partners yet.</Muted> : (
        <DataTable columns={["Partner", "Investors registered", "Capital committed", "Capital sourced", "Conversion"]}>
          {data.leaderboard.map((p) => (
            <tr key={p.id}>
              <td style={cellStyle}><strong>{p.full_name}</strong>{p.company && <div><Muted>{p.company}</Muted></div>}</td>
              <td style={cellStyle}>{p.registered}</td>
              <td style={cellStyle}>{usd(p.committed)}</td>
              <td style={cellStyle}>{usd(p.sourced)}</td>
              <td style={cellStyle}>{Math.round(p.conversion * 100)}%<div><Muted>{p.funded} of {p.registered} funded</Muted></div></td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}

function ComplianceTab({ onOpenLink }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.dashboardCompliance().then(setData).catch((e) => setError(e.message)); }, []);
  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const openFile = (id) => onOpenLink("kyc", id);
  const openCommitment = (id) => onOpenLink("commitments", id);
  const files = data.kyc_files;
  const expiring = files ? files.filter((f) => f.expired || f.expiring) : [];

  return (
    <div>
      <GroupTitle>Past Eligible without cleared KYC</GroupTitle>
      {!data.no_kyc.length ? <AllClear text="None. Every commitment past Eligible has cleared KYC." /> : (
        <DataTable columns={["Investor", "Vehicle", "Stage", "KYC"]}>
          {data.no_kyc.map((c) => (
            <tr key={c.commitment_id} onClick={() => openCommitment(c.commitment_id)} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><AlertTriangle size={13} color="#B8790A" /><strong>{c.investor_name}</strong></span></td>
              <td style={cellStyle}>{c.vehicle_name}</td>
              <td style={cellStyle}>{stageLabel(c.flow, c.stage)}</td>
              <td style={cellStyle}><StatusBadge status={c.kyc_status} colors={KYC_COLORS} /></td>
            </tr>
          ))}
        </DataTable>
      )}

      <GroupTitle>Stages waiting for sign-off</GroupTitle>
      {!data.gates.length ? <AllClear text="Nothing waiting. No commitment has all its documents in for the next stage." /> : (
        <DataTable columns={["Investor", "Vehicle", "Now at", "Ready for"]}>
          {data.gates.map((g) => (
            <tr key={g.commitment_id} onClick={() => openCommitment(g.commitment_id)} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><strong>{g.investor_name}</strong></td>
              <td style={cellStyle}>{g.vehicle_name}</td>
              <td style={cellStyle}>{g.stage}</td>
              <td style={cellStyle}>{g.next_stage}</td>
            </tr>
          ))}
        </DataTable>
      )}

      {!data.restricted ? (
        <>
          <GroupTitle>KYC files</GroupTitle>
          <Muted>KYC files need restricted access.</Muted>
        </>
      ) : (
        <>
          <GroupTitle>KYC expired or expiring within {data.expiring_days} days</GroupTitle>
          {!expiring.length ? <AllClear text="None." /> : (
            <DataTable columns={["Investor", "Status", "Refresh due"]}>
              {expiring.map((f) => (
                <tr key={f.id} onClick={() => openFile(f.id)} style={{ cursor: "pointer" }}>
                  <td style={cellStyle}><strong>{f.investor_name}</strong></td>
                  <td style={cellStyle}><StatusBadge status={f.expired ? "Expired" : "Cleared"} colors={KYC_COLORS} /></td>
                  <td style={cellStyle}>{dateStr(f.refresh_due)}</td>
                </tr>
              ))}
            </DataTable>
          )}
          <GroupTitle>KYC files by status, age and risk</GroupTitle>
          {!files.length ? <Muted>No KYC files yet.</Muted> : (
            <DataTable columns={["Investor", "Status", "Age", "Risk rating"]}>
              {files.map((f) => (
                <tr key={f.id} onClick={() => openFile(f.id)} style={{ cursor: "pointer" }}>
                  <td style={cellStyle}><strong>{f.investor_name}</strong><div><Muted>{f.kyc_type}</Muted></div></td>
                  <td style={cellStyle}><StatusBadge status={f.expired ? "Expired" : f.status} colors={KYC_COLORS} /></td>
                  <td style={cellStyle}>{count(f.age_days, "day")}</td>
                  <td style={cellStyle}>{f.risk_rating ? <StatusBadge status={f.risk_rating} colors={RISK_COLORS} /> : <Muted>Not set</Muted>}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </>
      )}

      <GroupTitle>Audit trail</GroupTitle>
      <AuditLogView />
    </div>
  );
}

function MoneyTab({ onNavigate, onOpenLink }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.dashboardMoney().then(setData).catch((e) => setError(e.message)); }, []);
  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const rows = data.vehicles.filter((v) => Number(v.committed_total) > 0 || Number(v.received_total) > 0);

  return (
    <div>
      <GroupTitle>Expected and received, by vehicle</GroupTitle>
      {!rows.length ? <Muted>Nothing committed yet.</Muted> : (
        <DataTable columns={["Vehicle or deal", "Committed", "Received", "Outstanding"]}>
          {rows.map((v) => (
            <tr key={v.id}>
              <td style={cellStyle}><strong>{v.name}</strong>{v.type === "IB Deal" && <div><Muted>Investors pay the startup directly</Muted></div>}</td>
              <td style={cellStyle}>{usd(v.committed_total)}</td>
              <td style={cellStyle}>{usd(v.received_total)}</td>
              <td style={{ ...cellStyle, fontWeight: 700 }}>{usd(v.outstanding_total)}</td>
            </tr>
          ))}
        </DataTable>
      )}

      <GroupTitle>Payments expected, by due date</GroupTitle>
      {!data.schedule.length ? <AllClear text="No payment instructions waiting." /> : (
        <DataTable columns={["Due", "Investor", "Vehicle", "Instructed", "Received", "Outstanding"]}>
          {data.schedule.map((s) => (
            <tr key={s.commitment_id} onClick={() => onOpenLink("commitments", s.commitment_id)} style={{ cursor: "pointer" }}>
              <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>{dateStr(s.due_date)}{s.days_overdue > 0 && <div><Muted style={{ color: BRAND.coralDark }}>{count(s.days_overdue, "day")} overdue</Muted></div>}{s.old_account && <div><Muted style={{ color: BRAND.coralDark }}>Old bank account: reissue</Muted></div>}</td>
              <td style={cellStyle}><strong>{s.investor_name}</strong></td>
              <td style={cellStyle}>{s.vehicle_name}</td>
              <td style={cellStyle}>{usd(s.instructed)}</td>
              <td style={cellStyle}>{usd(s.received)}</td>
              <td style={{ ...cellStyle, fontWeight: 700 }}>{usd(s.outstanding)}</td>
            </tr>
          ))}
        </DataTable>
      )}

      <GroupTitle>Not yet reconciled</GroupTitle>
      {!data.unreconciled.length ? <AllClear text="Everything is reconciled." /> : (
        <DataTable columns={["Date", "Type", "Who", "Amount", "Reference"]}>
          {data.unreconciled.map((m) => (
            <tr key={m.id} onClick={() => onNavigate("money")} style={{ cursor: "pointer" }}>
              <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>{dateStr(m.value_date)}</td>
              <td style={cellStyle}>{m.type}</td>
              <td style={cellStyle}>{m.who || "—"}</td>
              <td style={cellStyle}>{m.direction === "In" ? "+" : "−"}{usd(m.amount)}</td>
              <td style={cellStyle}>{m.bank_reference}</td>
            </tr>
          ))}
        </DataTable>
      )}

      <GroupTitle>Invoices due</GroupTitle>
      {!data.invoices.length ? <AllClear text="No invoices waiting." /> : (
        <DataTable columns={["Invoice", "Deal", "Status", "Total", "Due"]}>
          {data.invoices.map((f) => (
            <tr key={f.id} onClick={() => onNavigate("deals")} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><strong>{f.invoice_number}</strong><div><Muted>{f.billed_to}</Muted></div></td>
              <td style={cellStyle}>{f.vehicle_name}</td>
              <td style={cellStyle}>{f.status}</td>
              <td style={cellStyle}>{usd(f.total)}</td>
              <td style={cellStyle}>{dateStr(f.due_date)}{f.status === "Sent" && f.days_overdue > 0 && <div><Muted style={{ color: BRAND.coralDark }}>{count(f.days_overdue, "day")} overdue</Muted></div>}</td>
            </tr>
          ))}
        </DataTable>
      )}

      <GroupTitle>Payouts due</GroupTitle>
      {!data.payouts.length ? <AllClear text="No payouts waiting." /> : (
        <DataTable columns={["Partner", "From", "Next step", "Total"]}>
          {data.payouts.map((p) => (
            <tr key={p.id} onClick={() => onNavigate("money")} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><strong>{p.partner_name}</strong></td>
              <td style={cellStyle}>{p.investor_name}<div><Muted>{p.vehicle_name}</Muted></div></td>
              <td style={cellStyle}>{p.status === "Earned" ? "Approve" : "Pay"}</td>
              <td style={cellStyle}>{usd(p.total)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}

export function AdminOverview({ onNavigate, onOpenLink }) {
  const [tab, setTab] = useState("home");
  return (
    <div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "home", label: "Home" }, { id: "compliance", label: "Compliance" }, { id: "money", label: "Money position" }]} />
      {tab === "home" && <HomeTab onNavigate={onNavigate} onOpenLink={onOpenLink} />}
      {tab === "compliance" && <ComplianceTab onOpenLink={onOpenLink} />}
      {tab === "money" && <MoneyTab onNavigate={onNavigate} onOpenLink={onOpenLink} />}
    </div>
  );
}
