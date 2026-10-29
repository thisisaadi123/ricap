import React from "react";
import { LogOut } from "lucide-react";
import { BRAND, FONT } from "../brand.js";
import { GhostButton } from "./ui.jsx";

// One list per role, shared by the tab strip and the page title. Each
// milestone adds its pages here (see docs/TECH-SPEC.md section 6).
export function navItemsFor(role) {
  if (role === "admin") return [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "audit", label: "Audit log" },
  ];
  if (role === "partner") return [
    { id: "dashboard", label: "Dashboard" },
  ];
  return [
    { id: "home", label: "Home" },
  ];
}

export const ROLE_LABELS = { admin: "RIV Admin", partner: "Venture Partner", investor: "Investor" };

export function NavBar({ view, setView, user, onLogout }) {
  const items = navItemsFor(user.role);
  return (
    <div style={{ borderBottom: `1px solid ${BRAND.line}`, background: "#fff", position: "sticky", top: 0, zIndex: 20 }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 62, gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: BRAND.ink, display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/riv-logo-full.png" alt="Retail Innovation Ventures" style={{ height: 26 }} />
            RICap
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {items.map((it) => (
              <button key={it.id} onClick={() => setView(it.id)} style={{
                fontFamily: FONT, fontWeight: 600, fontSize: 13, padding: "8px 12px", borderRadius: 8,
                border: "none", cursor: "pointer",
                background: view === it.id ? BRAND.cream : "transparent",
                color: view === it.id ? BRAND.coral : "#7A756F",
              }}>
                {it.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#7A756F", textAlign: "right" }}>
            {user.name}
            <div style={{ fontSize: 11, color: "#9B958F" }}>{ROLE_LABELS[user.role]}</div>
          </div>
          <GhostButton onClick={onLogout} icon={LogOut} style={{ padding: "8px 12px" }}>Log out</GhostButton>
        </div>
      </div>
    </div>
  );
}
