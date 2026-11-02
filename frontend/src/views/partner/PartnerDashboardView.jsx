// Venture partner dashboard (PRD 6.11): their investors with live status,
// committed and received amounts, payouts, and what's open to bring people to.
import React, { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { api } from "../../api.js";
import { FONT } from "../../brand.js";
import { COMMITMENT_STATUS_COLORS, stageLabel } from "../../constants.js";
import { Card, DataTable, EmptyState, ErrorBanner, Spinner, StatusBadge, cellStyle, usd } from "../../components/ui.jsx";
import { Muted, SectionTitle } from "../../components/forms.jsx";
import { OpportunityCard } from "./PartnerOpportunityViews.jsx";

function Stat({ label, value, sub, onClick }) {
  return (
    <Card onClick={onClick} style={{ padding: 16, cursor: onClick ? "pointer" : "default" }}>
      <Muted>{label}</Muted>
      <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <Muted>{sub}</Muted>}
    </Card>
  );
}

export function PartnerDashboardView({ onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api.partnerInvestors(), api.partnerCommitments(), api.partnerPayouts(), api.partnerOpportunities()])
      .then(([i, c, p, o]) => setData({ investors: i.investors, commitments: c.commitments, payouts: p.totals, opportunities: o.opportunities }))
      .catch((e) => setError(e.message));
  }, []);
  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const { investors, commitments, payouts, opportunities } = data;
  const live = commitments.filter((c) => ["Active", "On hold"].includes(c.status));
  const committed = live.reduce((s, c) => s + Number(c.committed_amount || 0), 0);
  const received = commitments.reduce((s, c) => s + Number(c.received_total || 0), 0);
  const inReview = investors.filter((i) => i.registration_status === "Submitted").length;

  return (
    <div>
      <ErrorBanner text={error} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
        <Stat label="My investors" value={investors.length} sub={`${inReview} with RIV for review`} onClick={() => onNavigate("investors")} />
        <Stat label="Committed" value={usd(committed)} sub={`${live.length} live commitment${live.length === 1 ? "" : "s"}`} onClick={() => onNavigate("commitments")} />
        <Stat label="Received" value={usd(received)} onClick={() => onNavigate("commitments")} />
        <Stat label="Payouts accruing (estimate)" value={usd(payouts.accruing)} onClick={() => onNavigate("payouts")} />
        <Stat label="Earned, not yet paid" value={usd(payouts.earned)} onClick={() => onNavigate("payouts")} />
        <Stat label="Paid" value={usd(payouts.paid)} onClick={() => onNavigate("payouts")} />
      </div>

      <SectionTitle>My investors' commitments</SectionTitle>
      {!commitments.length ? <EmptyState icon={Users} title="No commitments yet" text="When an investor you brought commits to a vehicle or deal, it appears here." /> : (
        <DataTable columns={["Investor", "Vehicle", "Stage", "Committed", "Received"]}>
          {commitments.slice(0, 10).map((c) => (
            <tr key={c.id} onClick={() => onNavigate("commitments")} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><strong>{c.investor_name}</strong></td>
              <td style={cellStyle}>{c.vehicle_name}</td>
              <td style={cellStyle}>{stageLabel(c.flow, c.stage)}{c.status !== "Active" && <div style={{ marginTop: 4 }}><StatusBadge status={c.status} colors={COMMITMENT_STATUS_COLORS} /></div>}</td>
              <td style={cellStyle}>{c.committed_amount ? usd(c.committed_amount) : <>{usd(c.indicative_amount)}<div><Muted>indicated</Muted></div></>}</td>
              <td style={cellStyle}>{usd(c.received_total)}</td>
            </tr>
          ))}
        </DataTable>
      )}

      <SectionTitle>Open vehicles and live deals</SectionTitle>
      {!opportunities.length ? <Muted>Nothing open right now.</Muted> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
          {opportunities.map((o) => <OpportunityCard key={o.id} o={o} setError={setError} />)}
        </div>
      )}
    </div>
  );
}
