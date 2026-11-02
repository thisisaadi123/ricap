// Venture partner: updates that went to their investors (PRD 6.10). The
// contents appear only if RIV marked the update shareable.
import React, { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { api } from "../../api.js";
import { Card, EmptyState, ErrorBanner, Spinner, dateStr } from "../../components/ui.jsx";
import { DocLink, Muted } from "../../components/forms.jsx";

export function PartnerUpdatesView() {
  const [updates, setUpdates] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.partnerUpdates().then((r) => setUpdates(r.updates)).catch((e) => setError(e.message)); }, []);
  if (!updates) return error ? <ErrorBanner text={error} /> : <Spinner />;
  if (!updates.length) return <EmptyState icon={Megaphone} title="No updates yet" text="When RIV sends an update to investors you brought, you'll see it here." />;
  return (
    <div>
      <ErrorBanner text={error} />
      {updates.map((u) => (
        <Card key={u.id} style={{ padding: 14, marginBottom: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{u.title || u.type}</div>
          <Muted>{u.type} · {u.vehicle_name} · {dateStr(u.published_at)}</Muted>
          <div style={{ fontSize: 12.5, marginTop: 6 }}>Sent to: {u.investors.join(", ")}</div>
          {u.shareable_with_partners
            ? <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.65, marginTop: 8 }}>{u.body}</div>
            : <div style={{ marginTop: 6 }}><Muted>RIV keeps the contents of this update between it and the investors.</Muted></div>}
          {u.attachments.map((d) => <div key={d.id} style={{ marginTop: 8 }}><DocLink doc={d} onError={setError} /></div>)}
        </Card>
      ))}
    </div>
  );
}
