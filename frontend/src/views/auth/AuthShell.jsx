import React from "react";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { Card } from "../../components/ui.jsx";

// Centered card with the RIV logo, used by every signed-out screen.
export function AuthShell({ title = "RICap Portal", subtitle = "Retail Innovation Capital", children, footer }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND.cream, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <img src="/riv-logo-full.png" alt="Retail Innovation Ventures" style={{ height: 48, marginBottom: 10 }} />
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 22, color: BRAND.ink }}>{title}</div>
          <div style={{ fontFamily: FONT, fontSize: 13, color: MUTED, marginTop: 6 }}>{subtitle}</div>
        </div>
        <Card style={{ padding: 26 }}>{children}</Card>
        {footer && <div style={{ textAlign: "center", marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}
