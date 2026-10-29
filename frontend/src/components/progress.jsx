// Stage tracker and capital progress bar used by the commitment and vehicle
// screens.
import React from "react";
import { Check } from "lucide-react";
import { BRAND, FONT, MUTED } from "../brand.js";
import { stageLabel } from "../constants.js";
import { usd } from "./ui.jsx";

export function StageProgress({ flow, stages, current, dimmed }) {
  const idx = stages.indexOf(current);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", opacity: dimmed ? 0.55 : 1 }}>
      {stages.map((s, i) => {
        const done = i < idx;
        const now = i === idx;
        return (
          <React.Fragment key={s}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 5, fontFamily: FONT, fontSize: 11.5, fontWeight: now ? 700 : 600,
              padding: "5px 10px", borderRadius: 999, whiteSpace: "nowrap",
              background: now ? BRAND.coral : done ? "#E6F4EA" : "#F3F1EE", color: now ? "#fff" : done ? "#1E7A34" : "#8A857F",
            }}>
              {done && <Check size={11} />}{stageLabel(flow, s)}
            </div>
            {i < stages.length - 1 && <div style={{ width: 10, height: 1, background: BRAND.line }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Raised-so-far bar against a target. `parts` are drawn left to right,
// each [label, amount, colour].
export function CapitalBar({ target, parts }) {
  const t = Number(target) || 0;
  return (
    <div>
      <div style={{ display: "flex", height: 10, borderRadius: 999, background: "#F3F1EE", overflow: "hidden" }}>
        {t > 0 && parts.map(([label, amount, color]) => (
          <div key={label} title={`${label}: ${usd(amount)}`} style={{ width: `${Math.min(100, (Number(amount) / t) * 100)}%`, background: color }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, fontFamily: FONT, fontSize: 11.5, color: MUTED }}>
        {parts.map(([label, amount, color]) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} /> {label} {usd(amount)}
          </span>
        ))}
        {t > 0 && <span>of {usd(t)} target</span>}
      </div>
    </div>
  );
}
