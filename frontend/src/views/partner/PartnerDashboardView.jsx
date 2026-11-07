// Venture partner dashboard: the investors and startups the partner has
// introduced, each with its status. No dollar values are shown here.
import React, { useEffect, useState } from "react";
import { Rocket, Users } from "lucide-react";
import { api } from "../../api.js";
import { FONT } from "../../brand.js";
import { VP_INVESTOR_STATUSES, VP_STARTUP_STATUSES, VP_STATUS_COLORS } from "../../constants.js";
import { Card, DataTable, EmptyState, ErrorBanner, Spinner, StatusBadge, cellStyle, dateStr } from "../../components/ui.jsx";
import { Muted, SectionTitle } from "../../components/forms.jsx";

// A count with the number in each status underneath.
function CountCard({ title, total, statuses, items, onClick }) {
  return (
    <Card onClick={onClick} style={{ padding: 18, cursor: "pointer" }}>
      <Muted>{title}</Muted>
      <div style={{ fontFamily: FONT, fontSize: 28, fontWeight: 700, margin: "4px 0 12px" }}>{total}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {statuses.map((st) => {
          const n = items.filter((x) => x.vp_status === st).length;
          return (
            <span key={st} style={{ display: "inline-flex", gap: 6, alignItems: "center", opacity: n ? 1 : 0.45 }}>
              <StatusBadge status={st} colors={VP_STATUS_COLORS} />
              <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13 }}>{n}</span>
            </span>
          );
        })}
      </div>
    </Card>
  );
}

export function PartnerDashboardView({ onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api.partnerInvestors(), api.partnerStartups()])
      .then(([i, s]) => setData({ investors: i.investors, startups: s.startups }))
      .catch((e) => setError(e.message));
  }, []);
  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const { investors, startups } = data;

  return (
    <div>
      <ErrorBanner text={error} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(380px, 100%), 1fr))", gap: 14 }}>
        <CountCard title="Investors introduced" total={investors.length} statuses={VP_INVESTOR_STATUSES} items={investors} onClick={() => onNavigate("investors")} />
        <CountCard title="Startups introduced" total={startups.length} statuses={VP_STARTUP_STATUSES} items={startups} onClick={() => onNavigate("startups")} />
      </div>

      <SectionTitle>Investors</SectionTitle>
      {!investors.length ? <EmptyState icon={Users} title="No investors yet" text="Introduce investors from your network and follow their status here." /> : (
        <DataTable columns={["Investor", "Category", "Submitted", "Status"]}>
          {investors.slice(0, 10).map((i) => (
            <tr key={i.id} onClick={() => onNavigate("investors")} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><strong>{i.display_name || i.legal_name}</strong></td>
              <td style={cellStyle}>{i.category}</td>
              <td style={cellStyle}>{dateStr(i.created_at)}</td>
              <td style={cellStyle}><StatusBadge status={i.vp_status} colors={VP_STATUS_COLORS} /></td>
            </tr>
          ))}
        </DataTable>
      )}

      <SectionTitle>Startups</SectionTitle>
      {!startups.length ? <EmptyState icon={Rocket} title="No startups yet" text="Introduce startups from your network and follow their status here." /> : (
        <DataTable columns={["Startup", "Sector", "Submitted", "Status"]}>
          {startups.slice(0, 10).map((s) => (
            <tr key={s.id} onClick={() => onNavigate("startups")} style={{ cursor: "pointer" }}>
              <td style={cellStyle}><strong>{s.startup_name}</strong></td>
              <td style={cellStyle}>{s.sector || "—"}</td>
              <td style={cellStyle}>{dateStr(s.created_at)}</td>
              <td style={cellStyle}><StatusBadge status={s.vp_status} colors={VP_STATUS_COLORS} /></td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
