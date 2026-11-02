// Account statement, shared by the investor portal and the admin's investor
// record (PRD 6.10, 6.14). Printing it (or saving as PDF) leaves out the
// page around it.
import React, { useEffect, useState } from "react";
import { Printer, ScrollText } from "lucide-react";
import { BRAND, MUTED } from "../brand.js";
import { Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Spinner, cellStyle, dateStr, inputStyle, todayStr, usd } from "./ui.jsx";
import { Muted } from "./forms.jsx";

const PRINT_CSS = `
  @media print {
    body * { visibility: hidden; }
    .ricap-statement, .ricap-statement * { visibility: visible; }
    .ricap-statement { position: absolute; left: 0; top: 0; width: 100%; }
  }
`;

export function StatementView({ load }) {
  const today = todayStr();
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!asOf) return;
    setError("");
    load(asOf).then((r) => setData(r.statement)).catch((e) => setError(e.message));
  }, [asOf, load]);

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ width: 180 }}><Field label="As of"><input type="date" style={inputStyle} value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} /></Field></div>
        <div style={{ marginBottom: 14 }}><GhostButton icon={Printer} onClick={() => window.print()}>Print or save as PDF</GhostButton></div>
      </div>
      <ErrorBanner text={error} />
      {!data ? (error ? null : <Spinner />) : !data.lines.length ? (
        <EmptyState icon={ScrollText} title="Nothing to show yet" text="Your commitments and payments appear here once RIV has recorded them." />
      ) : (
        <div className="ricap-statement">
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Account statement: {data.investor_name}</div>
            <Muted>As of {dateStr(data.as_of)}. Amounts in USD. Issued by Retail Innovation Ventures.</Muted>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(180px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
            {[["Committed", data.totals.committed], ["Paid", data.totals.paid], ["Outstanding", data.totals.outstanding]].map(([label, value]) => (
              <Card key={label} style={{ padding: 14 }}><Muted>{label}</Muted><div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{usd(value)}</div></Card>
            ))}
          </div>
          <DataTable columns={["Vehicle or deal", "Stage", "Committed", "Paid", "Outstanding"]}>
            {data.lines.map((l) => (
              <tr key={l.commitment_id}>
                <td style={cellStyle}>
                  <strong>{l.vehicle_name}</strong>
                  {l.legal_entity && <div><Muted>{l.legal_entity}</Muted></div>}
                  {l.shares_issued && <div><Muted>{Number(l.shares_issued).toLocaleString("en-US")} shares{l.share_certificate_no ? `, certificate ${l.share_certificate_no}` : ""}</Muted></div>}
                  {l.payments.map((m, i) => <div key={i}><Muted>{dateStr(m.value_date)}: {usd(m.amount)} · {m.reference}</Muted></div>)}
                  {l.flow === "IB" && l.paid > 0 && <div><Muted>Paid directly to the startup</Muted></div>}
                </td>
                <td style={cellStyle}>{l.stage}{l.status !== "Active" && <div><Muted style={{ color: BRAND.coralDark }}>{l.status}</Muted></div>}</td>
                <td style={cellStyle}>{l.committed === null ? <>{usd(l.indicative)}<div><Muted>{l.flow === "Fund" ? "soft commitment" : "indicative"}</Muted></div></> : usd(l.committed)}</td>
                <td style={cellStyle}>{usd(l.paid)}</td>
                <td style={{ ...cellStyle, fontWeight: l.outstanding > 0 ? 700 : 400 }}>{usd(l.outstanding)}</td>
              </tr>
            ))}
          </DataTable>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 10 }}>For information only; not investment advice. Indicative and soft commitment figures are not counted as committed.</div>
        </div>
      )}
    </div>
  );
}
