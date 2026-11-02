// Venture partner: their own payouts (PRD 6.9, 9.1).
import React, { useEffect, useState } from "react";
import { Banknote } from "lucide-react";
import { api } from "../../api.js";
import { Card, DataTable, EmptyState, ErrorBanner, Spinner, StatusBadge, cellStyle, dateStr, usd } from "../../components/ui.jsx";
import { Muted } from "../../components/forms.jsx";
import { BRAND } from "../../brand.js";

const COLORS = {
  Accruing: { bg: "#F3F1EE", fg: "#8A857F" }, Earned: { bg: "#FFF4E0", fg: "#B8790A" }, Approved: { bg: "#E8F0FE", fg: BRAND.blue }, Paid: { bg: "#E6F4EA", fg: "#1E7A34" },
};

export function PartnerPayoutsView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.partnerPayouts().then(setData).catch((e) => setError(e.message)); }, []);
  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginBottom: 18 }}>
        <Card style={{ padding: 16 }}><Muted>Accruing (estimate)</Muted><div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{usd(data.totals.accruing)}</div></Card>
        <Card style={{ padding: 16 }}><Muted>Earned, not yet paid</Muted><div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{usd(data.totals.earned)}</div></Card>
        <Card style={{ padding: 16 }}><Muted>Paid</Muted><div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{usd(data.totals.paid)}</div></Card>
      </div>
      {!data.payouts.length ? <EmptyState icon={Banknote} title="No payouts yet" text="When an investor you brought commits to a vehicle or deal, your payout appears here." /> : (
        <DataTable columns={["Investor", "Vehicle", "Status", "How it's worked out", "Amount incl. VAT"]}>
          {data.payouts.map((p) => (
            <tr key={p.id}>
              <td style={cellStyle}><strong>{p.investor_name}</strong></td>
              <td style={cellStyle}>{p.vehicle_name}</td>
              <td style={cellStyle}><StatusBadge status={p.status} colors={COLORS} />{p.status === "Accruing" && <div><Muted>Estimate; can change</Muted></div>}{p.paid_at && <div><Muted>{dateStr(p.paid_at)} · {p.payment_reference}</Muted></div>}</td>
              <td style={cellStyle}>{Number(p.pct)}% of {usd(p.basis_amount)}<div><Muted>{p.flow === "IB" ? "RIV's fee on this placement" : "capital raised"}</Muted></div></td>
              <td style={cellStyle}><strong>{usd(p.total)}</strong><div><Muted>{usd(p.amount)} + {Number(p.vat_pct)}% VAT</Muted></div></td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
