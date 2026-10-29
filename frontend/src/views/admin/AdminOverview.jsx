import React, { useEffect, useState } from "react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { Card, ErrorBanner, Spinner } from "../../components/ui.jsx";
import { ROLE_LABELS } from "../../components/NavBar.jsx";

function Tile({ label, value, sub, onClick }) {
  return (
    <Card onClick={onClick} style={{ padding: 18, cursor: onClick ? "pointer" : "default" }}>
      <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 700, color: BRAND.ink, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontFamily: FONT, fontSize: 11.5, color: MUTED, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

// M0 overview: who has access. Capital, pipeline and compliance tiles are
// added from M3 onward (PRD 6.11).
export function AdminOverview({ onNavigate }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listUsers().then((r) => setUsers(r.users)).catch((err) => setError(err.message));
  }, []);

  if (error) return <ErrorBanner text={error} />;
  if (!users) return <Spinner />;

  const count = (role, status) => users.filter((u) => u.role === role && (!status || u.status === status)).length;
  const pending = users.filter((u) => u.status === "invited").length;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
      {["partner", "investor", "admin"].map((role) => (
        <Tile key={role} label={`${ROLE_LABELS[role]}s`} value={count(role, "active")} sub={`${count(role)} in total`} onClick={() => onNavigate("users")} />
      ))}
      <Tile label="Invites not yet accepted" value={pending} sub="Resend from the Users page" onClick={() => onNavigate("users")} />
    </div>
  );
}
