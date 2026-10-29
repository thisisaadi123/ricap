// Investor portal screens for M2 (PRD 6.14): home, KYC checklist and
// documents shared by RIV. Holdings, signing and payments arrive with M3-M6.
import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileText, FolderOpen, ShieldCheck } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { KYC_COLORS, KYC_ITEM_COLORS } from "../../constants.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, PrimaryButton, Spinner, StatusBadge, SuccessBanner, cellStyle, dateStr, useSuccessMessage,
} from "../../components/ui.jsx";
import { DocLink, FileButton, Muted, SignatureBadge } from "../../components/forms.jsx";

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

export function InvestorHome({ user, onNavigate }) {
  const [me, setMe] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.investorMe().then((r) => setMe(r.investor)).catch((e) => setError(e.message));
    api.investorKyc().then(setKyc).catch(() => {});
    api.investorDocuments().then((r) => setDocs(r.documents)).catch(() => {});
  }, []);

  if (error) return <ErrorBanner text={error} />;
  if (!me) return <Spinner />;
  const status = kycStatusOf(kyc?.file);
  const outstanding = kyc?.items?.filter((i) => i.required && (i.status === "Requested" || i.status === "Rejected")).length || 0;

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 14, color: BRAND.ink, marginBottom: 18 }}>
        Welcome, {user.name}. You're signed in for <strong>{me.name}</strong>.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        <Card style={{ padding: 18, cursor: "pointer" }} onClick={() => onNavigate("kyc")}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><ShieldCheck size={18} color={BRAND.coral} /><strong>KYC</strong></div>
          <StatusBadge status={status} colors={KYC_COLORS} />
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 10, lineHeight: 1.6 }}>
            {KYC_MESSAGES[status]}{kyc?.file?.can_upload && outstanding ? ` ${outstanding} document${outstanding > 1 ? "s" : ""} still needed.` : ""}
          </div>
        </Card>
        <Card style={{ padding: 18, cursor: "pointer" }} onClick={() => onNavigate("documents")}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><FileText size={18} color={BRAND.coral} /><strong>Documents</strong></div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{docs ? docs.length : "–"}</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>shared with you by RIV</div>
        </Card>
        <Card style={{ padding: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Your investments</div>
          <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>Your holdings, documents to sign and payment details will appear here.</div>
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
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 14 }}>PDF, JPG, PNG or Word, up to 10 MB each. Only RIV's authorised team can see your documents.</div>
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
            <td style={cellStyle}><div style={{ fontWeight: 600 }}>{d.title}{d.version > 1 && <Muted> · v{d.version}</Muted>}</div><DocLink doc={d} onError={setError} /></td>
            <td style={cellStyle}>{d.doc_type}</td>
            <td style={cellStyle}><SignatureBadge status={d.signature_status} /></td>
            <td style={cellStyle}>{dateStr(d.uploaded_at)}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
