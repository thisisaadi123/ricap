// Investor portal (PRD 6.11, 6.14): home dashboard, KYC checklist and
// documents shared by RIV.
import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileText, FolderOpen, ShieldCheck } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { KYC_COLORS, KYC_ITEM_COLORS, stageLabel } from "../../constants.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, PrimaryButton, Spinner, StatusBadge, SuccessBanner, cellStyle, dateStr, usd, useSuccessMessage,
} from "../../components/ui.jsx";
import { DocLink, FileButton, Muted, SectionTitle, SignatureBadge } from "../../components/forms.jsx";

function kycStatusOf(file) {
  if (!file) return "Not started";
  return file.expired ? "Expired" : file.status;
}

const KYC_MESSAGES = {
  "Not started": "RIV will open your KYC checklist soon. You'll get an email when it's ready.",
  Open: "Upload each document on your checklist, then submit it to RIV.",
  Submitted: "Thanks. RIV is reviewing your documents.",
  "Information requested": "RIV needs something more from you. See the note on your KYC page.",
  Cleared: "Your KYC is complete.",
  Rejected: "Please contact RIV about your KYC.",
  Expired: "Your KYC is due for a refresh. RIV will send a new checklist.",
};

export function InvestorHome({ user, onNavigate, onOpenInvestment, onOpenUpdate }) {
  const [me, setMe] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [docs, setDocs] = useState(null);
  const [investments, setInvestments] = useState(null);
  const [updates, setUpdates] = useState(null);
  const [opportunities, setOpportunities] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.investorUpdates().then((r) => setUpdates(r.updates)).catch(() => {});
    api.investorOpportunities().then((r) => setOpportunities(r.opportunities)).catch(() => {});
    api.investorCommitments().then((r) => setInvestments(r.commitments)).catch(() => {});
    api.investorMe().then((r) => setMe(r.investor)).catch((e) => setError(e.message));
    api.investorKyc().then(setKyc).catch(() => {});
    api.investorDocuments().then((r) => setDocs(r.documents)).catch(() => {});
  }, []);

  if (error) return <ErrorBanner text={error} />;
  if (!me) return <Spinner />;
  const status = kycStatusOf(kyc?.file);
  const outstanding = kyc?.items?.filter((i) => i.required && (i.status === "Requested" || i.status === "Rejected")).length || 0;
  const holdings = (investments || []).filter((i) => ["Active", "On hold"].includes(i.status));
  const actions = holdings.filter((i) => i.action_needed);
  const kycAction = kyc?.file?.can_upload;
  const paid = (c) => Number(c.received_total || 0) + Number(c.funds_transferred_amount || 0);
  const totals = holdings.reduce((t, c) => ({ committed: t.committed + Number(c.committed_amount || 0), paid: t.paid + paid(c), outstanding: t.outstanding + Number(c.outstanding || 0) }), { committed: 0, paid: 0, outstanding: 0 });
  const newOpportunities = (opportunities || []).filter((o) => !o.my_commitment_id);
  const clickable = { padding: 18, cursor: "pointer" };

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 14, color: BRAND.ink, marginBottom: 18 }}>
        Welcome, {user.name}. You're signed in for <strong>{me.name}</strong>.
      </div>

      <SectionTitle>Actions needed</SectionTitle>
      {!kycAction && !actions.length ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#1E7A34" }}><CheckCircle2 size={15} /> Nothing for you to do right now.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {kycAction && (
            <Card style={clickable} onClick={() => onNavigate("kyc")}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><ShieldCheck size={16} color={BRAND.coral} /><strong style={{ fontSize: 13.5 }}>Complete your KYC</strong></div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6, lineHeight: 1.6 }}>{KYC_MESSAGES[status]}{outstanding ? ` ${outstanding} document${outstanding > 1 ? "s" : ""} still needed.` : ""}</div>
            </Card>
          )}
          {actions.map((c) => (
            <Card key={c.id} style={clickable} onClick={() => onOpenInvestment(c.id)}>
              <strong style={{ fontSize: 13.5 }}>{c.vehicle_name}</strong>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 6, lineHeight: 1.6 }}>{c.next_action}</div>
            </Card>
          ))}
        </div>
      )}

      <SectionTitle>My holdings</SectionTitle>
      {!holdings.length ? <Muted>Your investments appear here once you've shown interest in an opportunity.</Muted> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(180px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
            {[["Committed", totals.committed], ["Paid", totals.paid], ["Outstanding", totals.outstanding]].map(([label, value]) => (
              <Card key={label} style={{ padding: 14 }}><Muted>{label}</Muted><div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{usd(value)}</div></Card>
            ))}
          </div>
          <DataTable columns={["Vehicle or deal", "Stage", "Committed", "Paid", "Outstanding"]}>
            {holdings.map((c) => (
              <tr key={c.id} onClick={() => onOpenInvestment(c.id)} style={{ cursor: "pointer" }}>
                <td style={cellStyle}><strong>{c.vehicle_name}</strong></td>
                <td style={cellStyle}>{stageLabel(c.flow, c.stage)}{c.status !== "Active" && <div><Muted>{c.status}</Muted></div>}</td>
                <td style={cellStyle}>{c.committed_amount ? usd(c.committed_amount) : <>{usd(c.indicative_amount)}<div><Muted>{c.flow === "Fund" ? "soft commitment" : "indicated"}</Muted></div></>}</td>
                <td style={cellStyle}>{usd(paid(c))}</td>
                <td style={cellStyle}>{c.outstanding === null ? "—" : usd(c.outstanding)}</td>
              </tr>
            ))}
          </DataTable>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))", gap: 14, marginTop: 24 }}>
        <Card style={clickable} onClick={() => (updates?.[0] ? onOpenUpdate(updates[0].id) : onNavigate("updates"))}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Latest update</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{updates?.[0]?.title || "Nothing yet"}</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.6 }}>
            {updates?.length ? `${updates.filter((u) => !u.first_read_at).length} unread of ${updates.length}` : "Letters, statements and deal news from RIV appear here."}
          </div>
        </Card>
        <Card style={clickable} onClick={() => onNavigate("statement")}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Account statement</div>
          <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>See or print your position on any date.</div>
        </Card>
        <Card style={clickable} onClick={() => onNavigate("opportunities")}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Opportunities</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{opportunities ? newOpportunities.length : "–"}</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>open that you could show interest in</div>
        </Card>
        <Card style={clickable} onClick={() => onNavigate("documents")}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><FileText size={18} color={BRAND.coral} /><strong>Documents</strong></div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{docs ? docs.length : "–"}</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>shared with you by RIV</div>
        </Card>
        <Card style={clickable} onClick={() => onNavigate("kyc")}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><ShieldCheck size={18} color={BRAND.coral} /><strong>KYC</strong></div>
          <StatusBadge status={status} colors={KYC_COLORS} />
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 10, lineHeight: 1.6 }}>{KYC_MESSAGES[status]}</div>
        </Card>
      </div>
    </div>
  );
}

export function InvestorKycView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => { api.investorKyc().then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);

  if (!data) return error ? <ErrorBanner text={error} /> : <Spinner />;
  const { file, items } = data;
  if (!file) return <EmptyState icon={ShieldCheck} title="Your KYC checklist isn't ready yet" text={KYC_MESSAGES["Not started"]} />;

  const status = kycStatusOf(file);
  const missing = items.filter((i) => i.required && !["Received", "Verified"].includes(i.status));

  async function submit() {
    setSubmitting(true); setError("");
    try { await api.investorSubmitKyc(); showSuccess("Submitted. RIV will review your documents."); load(); }
    catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <div>
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusBadge status={status} colors={KYC_COLORS} />
          {file.refresh_due && status === "Cleared" && <Muted>Next refresh {dateStr(file.refresh_due)}</Muted>}
        </div>
        <div style={{ fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>{KYC_MESSAGES[status]}</div>
        {file.request_note && (
          <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 10, background: "#FFF4E0", fontSize: 13 }}>
            <strong>From RIV:</strong> {file.request_note}
          </div>
        )}
      </Card>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <DataTable columns={["Document", "Your upload", "Status", ""]}>
        {items.map((it) => (
          <tr key={it.id}>
            <td style={cellStyle}>
              <div style={{ fontWeight: 600 }}>{it.label}{!it.required && <Muted> · optional</Muted>}</div>
              {it.description && <Muted>{it.description}</Muted>}
              {it.review_note && <div style={{ fontSize: 12, color: BRAND.coralDark, marginTop: 4 }}>Please re-upload: {it.review_note}</div>}
            </td>
            <td style={cellStyle}>
              {it.documents.length ? it.documents.map((d) => <div key={d.id}><DocLink doc={d} onError={setError} /> <Muted>{dateStr(d.uploaded_at)}</Muted></div>) : <Muted>Not uploaded yet</Muted>}
            </td>
            <td style={cellStyle}>{it.status === "Verified" ? <span style={{ display: "inline-flex", gap: 5, alignItems: "center", color: "#1E7A34", fontWeight: 600, fontSize: 12 }}><CheckCircle2 size={14} /> Verified</span> : <StatusBadge status={it.status === "Received" ? "Received" : it.status} colors={KYC_ITEM_COLORS} label={it.status === "Requested" ? "Needed" : it.status === "Rejected" ? "Re-upload" : it.status} />}</td>
            <td style={{ ...cellStyle, textAlign: "right" }}>
              {file.can_upload && it.status !== "Verified" && (
                <FileButton label={it.documents.length ? "Replace" : "Upload"} onFile={async (f) => {
                  setError("");
                  try { await api.investorUploadKyc(it.id, f); showSuccess(`${it.label} uploaded.`); load(); } catch (e) { setError(e.message); }
                }} />
              )}
            </td>
          </tr>
        ))}
      </DataTable>
      {file.can_upload && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 16 }}>
          {missing.length > 0 && <Muted>{missing.length} required document{missing.length > 1 ? "s" : ""} still needed</Muted>}
          <PrimaryButton disabled={submitting || missing.length > 0} onClick={submit}>{submitting ? "Submitting…" : "Submit to RIV"}</PrimaryButton>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 14 }}>PDF, JPG, PNG or Word, up to 4 MB each. Only RIV's authorised team can see your documents.</div>
    </div>
  );
}

export function InvestorDocumentsView() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.investorDocuments().then((r) => setDocs(r.documents)).catch((e) => setError(e.message)); }, []);
  if (!docs) return error ? <ErrorBanner text={error} /> : <Spinner />;
  if (!docs.length) return <EmptyState icon={FolderOpen} title="No documents yet" text="Agreements and other documents RIV shares with you will appear here." />;
  return (
    <div>
      <ErrorBanner text={error} />
      <DataTable columns={["Document", "Type", "Signature", "Date"]}>
        {docs.map((d) => (
          <tr key={d.id}>
            <td style={cellStyle}><div style={{ fontWeight: 600 }}>{d.title}{d.version > 1 && <Muted> · v{d.version}</Muted>}</div><DocLink doc={d} onError={setError} />{d.vehicle_name && <div><Muted>{d.vehicle_name}</Muted></div>}</td>
            <td style={cellStyle}>{d.doc_type}</td>
            <td style={cellStyle}><SignatureBadge status={d.signature_status} /></td>
            <td style={cellStyle}>{dateStr(d.uploaded_at)}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
