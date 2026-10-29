import React, { useEffect, useState } from "react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { Card, ErrorBanner, Spinner } from "../../components/ui.jsx";

function Tile({ label, value, sub, onClick, highlight }) {
  return (
    <Card onClick={onClick} style={{ padding: 18, cursor: onClick ? "pointer" : "default", borderColor: highlight ? "#F3D9A4" : BRAND.line, background: highlight ? "#FFFBF2" : "#fff" }}>
      <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 700, color: BRAND.ink, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontFamily: FONT, fontSize: 11.5, color: MUTED, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

function Group({ title, children }) {
  return (
    <>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, color: MUTED, margin: "22px 0 10px", textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>{children}</div>
    </>
  );
}

// Work queues for M1-M2. Capital, pipeline and money tiles are added from
// M3 onward (PRD 6.11).
export function AdminOverview({ onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api.listUsers(),
      api.listPartners(),
      api.listInvestors(),
      api.listKyc().catch(() => null), // needs restricted access
    ]).then(([u, p, i, k]) => setData({ users: u.users, partners: p.partners, investors: i.investors, kyc: k?.files ?? null }))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorBanner text={error} />;
  if (!data) return <Spinner />;

  const { users, partners, investors, kyc } = data;
  const toReview = investors.filter((i) => i.registration_status === "Submitted").length;
  const approved = investors.filter((i) => i.registration_status === "Approved");
  const kycCleared = approved.filter((i) => i.kyc_status === "Cleared").length;
  const onboarding = partners.filter((p) => p.onboarding_stage !== "Onboarded" && p.status === "Active").length;
  const kycWaiting = kyc ? kyc.filter((f) => f.status === "Submitted").length : null;
  const kycExpired = kyc ? kyc.filter((f) => f.expired).length : null;

  return (
    <div>
      <Group title="Needs attention">
        <Tile label="Investor registrations to review" value={toReview} sub="From venture partners" onClick={() => onNavigate("investors")} highlight={toReview > 0} />
        <Tile label="KYC waiting for review" value={kycWaiting ?? "–"} sub={kyc ? "Submitted by investors" : "Needs restricted access"} onClick={() => onNavigate("kyc")} highlight={kycWaiting > 0} />
        <Tile label="KYC expired" value={kycExpired ?? "–"} sub={kyc ? "Open a refresh" : "Needs restricted access"} onClick={() => onNavigate("kyc")} highlight={kycExpired > 0} />
        <Tile label="Partners still onboarding" value={onboarding} sub="Agreement not yet signed" onClick={() => onNavigate("partners")} />
      </Group>
      <Group title="People">
        <Tile label="Approved investors" value={approved.length} sub={`${kycCleared} with KYC cleared`} onClick={() => onNavigate("investors")} />
        <Tile label="Onboarded venture partners" value={partners.filter((p) => p.onboarding_stage === "Onboarded").length} sub={`${partners.length} in total`} onClick={() => onNavigate("partners")} />
        <Tile label="Active logins" value={users.filter((u) => u.status === "active").length} sub={`${users.filter((u) => u.status === "invited").length} invites not yet accepted`} onClick={() => onNavigate("users")} />
      </Group>
    </div>
  );
}
