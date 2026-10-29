import React, { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { api } from "../../api.js";
import { MUTED } from "../../brand.js";
import { DataTable, EmptyState, ErrorBanner, Spinner, cellStyle, dateTimeStr } from "../../components/ui.jsx";

// Plain-language labels for audit actions. Unknown actions fall back to the
// raw action name, so new actions show up even before they're added here.
const ACTION_LABELS = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.code_failed": "Wrong sign-in code",
  "auth.invite_accepted": "Accepted invite",
  "auth.password_reset_requested": "Asked for password reset",
  "auth.password_reset": "Reset password",
  "user.invited": "Invited user",
  "user.invite_resent": "Resent invite",
  "user.suspended": "Suspended user",
  "user.reactivated": "Reactivated user",
};

function describeDetails(details) {
  if (!details || !Object.keys(details).length) return "";
  return Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(" · ");
}

export function AuditLogView() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listAudit().then((r) => setEntries(r.entries)).catch((err) => setError(err.message));
  }, []);

  if (error) return <ErrorBanner text={error} />;
  if (!entries) return <Spinner />;
  if (!entries.length) return <EmptyState icon={ScrollText} title="Nothing logged yet" text="Sign-ins, invites and every change will appear here." />;

  return (
    <div>
      <div style={{ color: MUTED, fontSize: 12, marginBottom: 12 }}>Latest 200 events. Entries can't be edited or deleted.</div>
      <DataTable columns={["When", "Who", "What", "Record", "Details", "IP"]}>
        {entries.map((e) => (
          <tr key={e.id}>
            <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>{dateTimeStr(e.created_at)}</td>
            <td style={cellStyle}>{e.actor_name || <span style={{ color: MUTED }}>Unknown</span>}</td>
            <td style={cellStyle}>{ACTION_LABELS[e.action] || e.action}</td>
            <td style={cellStyle}>{e.object_type ? `${e.object_type} #${e.object_id}` : "—"}</td>
            <td style={{ ...cellStyle, color: MUTED, fontSize: 11.5 }}>{describeDetails(e.details)}</td>
            <td style={{ ...cellStyle, color: MUTED, fontSize: 11.5 }}>{e.ip || "—"}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
