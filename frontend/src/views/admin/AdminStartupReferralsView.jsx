// Startup referrals: startups that venture partners introduced. RIV reviews
// each one, settles duplicates, and opens an IB deal draft from an accepted
// one. Startups have no login (IB-2).
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Rocket } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, MUTED } from "../../brand.js";
import { DEAL_INSTRUMENTS, REFERRAL_STATUS_COLORS } from "../../constants.js";
import {
  Card, DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton, Spinner, StatusBadge, SuccessBanner,
  cellStyle, dateStr, inputStyle, useSuccessMessage,
} from "../../components/ui.jsx";
import { KeyValues, Muted, SectionTitle, Select, Tabs } from "../../components/forms.jsx";

function DuplicateList({ duplicates }) {
  return duplicates.map((d) => (
    <div key={`${d.type}-${d.id}`} style={{ padding: "8px 0", borderTop: `1px solid ${BRAND.line}`, fontSize: 12.5 }}>
      <strong>{d.name}</strong> · {d.type === "deal" ? "IB deal" : "Referral"} #{d.id} · <span style={{ color: MUTED }}>{d.status}</span>
      <div><Muted>{d.reasons.join(", ")}{d.partner_name ? ` · introduced by ${d.partner_name}` : ""}</Muted></div>
    </div>
  ));
}

function ReviewPanel({ referral, duplicates, onDone, setError }) {
  const [reason, setReason] = useState("");
  const [dupOf, setDupOf] = useState(duplicates.length ? `${duplicates[0].type}:${duplicates[0].id}` : "");
  const [busy, setBusy] = useState(false);

  async function decide(decision) {
    setBusy(true); setError("");
    try {
      const body = { decision, reason };
      if (decision === "duplicate") {
        const [type, id] = dupOf.split(":");
        body[type === "deal" ? "duplicate_of_deal_id" : "duplicate_of_referral_id"] = Number(id);
      }
      await api.reviewStartupReferral(referral.id, body);
      onDone(decision);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: 16, marginBottom: 18, background: "#FFFBF2", borderColor: "#F3D9A4" }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Review this introduction</div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 10 }}>
        Introduced by {referral.partner_name} on {dateStr(referral.created_at)}. Accepting credits the startup to the partner for their credit window ({referral.credit_window_months} months).
        The partner is told "not accepted" for a rejection or a duplicate.
      </div>
      {duplicates.length ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 600, fontSize: 12.5, color: "#B8790A" }}><AlertTriangle size={14} /> Possible duplicates (the partner can't see these)</div>
          <DuplicateList duplicates={duplicates} />
        </div>
      ) : <div style={{ fontSize: 12.5, marginBottom: 12 }}>No possible duplicates found.</div>}
      <Field label="Reason" hint="Needed to reject. Shown to the partner when rejecting."><input style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {referral.status === "Submitted" && <GhostButton disabled={busy} onClick={() => decide("under_review")}>Mark under review</GhostButton>}
        <PrimaryButton disabled={busy} onClick={() => decide("accept")}>Accept</PrimaryButton>
        <GhostButton disabled={busy} onClick={() => decide("reject")}>Reject</GhostButton>
        {duplicates.length > 0 && (
          <>
            <GhostButton disabled={busy} onClick={() => decide("duplicate")}>Mark as duplicate of</GhostButton>
            <Select value={dupOf} onChange={setDupOf} options={duplicates.map((d) => ({ value: `${d.type}:${d.id}`, label: `${d.type === "deal" ? "Deal" : "Referral"} #${d.id} ${d.name}` }))} style={{ width: 260, padding: "8px 10px" }} />
          </>
        )}
      </div>
    </Card>
  );
}

const EMPTY_DEAL = { instrument: "Equity", round_size: "", pre_money_valuation: "", riv_allocation: "", fee_pct: "", sweat_equity_pct: "", below_floor_reason: "" };

function DealDraftPanel({ referral, onDone, setError, onOpenDeal }) {
  const [form, setForm] = useState(EMPTY_DEAL);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const num = (k, props = {}) => <input style={inputStyle} type="number" min="0" step="any" value={form[k]} onChange={set(k)} {...props} />;

  if (referral.deal_vehicle_id) {
    return (
      <Card style={{ padding: 16, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>IB deal</div>
        <div style={{ fontSize: 12.5, marginBottom: 10 }}>{referral.deal_name} · {referral.deal_status}</div>
        <GhostButton onClick={() => onOpenDeal(referral.deal_vehicle_id)}>Open the deal</GhostButton>
      </Card>
    );
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
      await api.createDealFromReferral(referral.id, body);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: 16, marginBottom: 18 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Open an IB deal draft</div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12, lineHeight: 1.6 }}>
        The draft takes the startup's name and sector and the founder as the startup contact, and records {referral.partner_name} as the introducing partner.
        Enter the round terms; the usual deal floor applies (PRD 6.8). Mandate, teaser and going live follow on the IB deals page.
      </div>
      <form onSubmit={create}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>
          <Field label="Instrument" required><Select value={form.instrument} onChange={(v) => setForm((f) => ({ ...f, instrument: v }))} options={DEAL_INSTRUMENTS} /></Field>
          <Field label="Round size (USD)" required>{num("round_size", { required: true })}</Field>
          <Field label="Pre-money valuation (USD)" required>{num("pre_money_valuation", { required: true })}</Field>
          <Field label="RIV allocation (USD)">{num("riv_allocation")}</Field>
          <Field label="Fee %" hint="Blank = 5%.">{num("fee_pct", { max: 100 })}</Field>
          <Field label="Sweat equity %">{num("sweat_equity_pct", { max: 100 })}</Field>
        </div>
        <Field label="Reason for going below the floor" hint="Needed for rounds under USD 500K."><input style={inputStyle} value={form.below_floor_reason} onChange={set("below_floor_reason")} /></Field>
        <div style={{ display: "flex", justifyContent: "flex-end" }}><PrimaryButton type="submit" disabled={busy}>{busy ? "Creating…" : "Create deal draft"}</PrimaryButton></div>
      </form>
    </Card>
  );
}

function ReferralDetail({ id, onClose, onChanged, onOpenDeal }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();

  const load = useCallback(() => {
    api.getStartupReferral(id).then(setData).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <Modal title="Startup referral" onClose={onClose} width={780}>{error ? <ErrorBanner text={error} /> : <Spinner />}</Modal>;
  const r = data.referral;
  const open = ["Submitted", "Under review"].includes(r.status);
  const link = (url) => (url ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: BRAND.blue }}>{url.replace(/^https?:\/\//, "")}</a> : null);

  return (
    <Modal title={r.startup_name} onClose={onClose} width={780}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <StatusBadge status={r.status} colors={REFERRAL_STATUS_COLORS} />
        <Muted>Introduced by {r.partner_name}{r.partner_company ? ` (${r.partner_company})` : ""} · {dateStr(r.created_at)}</Muted>
      </div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      {open && (
        <ReviewPanel referral={r} duplicates={data.duplicates} setError={setError}
          onDone={(d) => { showSuccess({ under_review: "Marked under review.", accept: "Startup accepted.", reject: "Introduction rejected.", duplicate: "Marked as duplicate." }[d]); load(); onChanged(); }} />
      )}
      {r.status === "Accepted" && (
        <DealDraftPanel referral={r} setError={setError} onOpenDeal={onOpenDeal}
          onDone={() => { showSuccess("IB deal draft created."); load(); onChanged(); }} />
      )}
      {!open && data.duplicates.length > 0 && (
        <Card style={{ padding: 14, marginBottom: 18 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>Possible duplicates</div>
          <DuplicateList duplicates={data.duplicates} />
        </Card>
      )}
      <KeyValues rows={[
        ["Website", link(r.website)],
        ["LinkedIn", link(r.linkedin_url)],
        ["Founder", `${r.founder_name} · ${r.founder_email}`],
        ["Sector", r.sector],
        ["Stage", r.startup_stage],
        ["Fundraising", r.fundraising],
        ["Partner met the founder", r.personally_interacted],
        ["Interested in RISE GTM", r.interested_in_rise_gtm],
        ["Permission confirmed", dateStr(r.consent_at)],
        r.status === "Accepted" && ["Partner credit until", dateStr(r.credit_expires_at)],
        r.status === "Rejected" && ["Rejection reason", r.rejection_reason],
        r.status === "Duplicate" && ["Duplicate of", `${r.duplicate_of_referral_id ? `Referral #${r.duplicate_of_referral_id} ${r.duplicate_of_referral_name}` : `IB deal #${r.duplicate_of_deal_id} ${r.duplicate_of_deal_name}`}${r.rejection_reason ? ` · ${r.rejection_reason}` : ""}`],
      ]} />
      <SectionTitle>Description</SectionTitle>
      <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{r.description}</div>
      {r.problem_solved && (<><SectionTitle>Problem being solved</SectionTitle><div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{r.problem_solved}</div></>)}
      <SectionTitle>Why the partner is referring it</SectionTitle>
      <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{r.why_referring}</div>
    </Modal>
  );
}

export function AdminStartupReferralsView({ openId, setOpenId, onOpenDeal }) {
  const [referrals, setReferrals] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("review");

  const load = useCallback(() => {
    api.listStartupReferrals().then((r) => setReferrals(r.referrals)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = {
    review: (r) => ["Submitted", "Under review"].includes(r.status),
    accepted: (r) => r.status === "Accepted",
    declined: (r) => ["Rejected", "Duplicate"].includes(r.status),
    all: () => true,
  };
  const shown = (referrals || []).filter(groups[tab]);

  return (
    <div>
      <ErrorBanner text={error} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "review", label: "To review", count: referrals ? referrals.filter(groups.review).length : undefined },
        { id: "accepted", label: "Accepted", count: referrals ? referrals.filter(groups.accepted).length : undefined },
        { id: "declined", label: "Rejected or duplicate", count: referrals ? referrals.filter(groups.declined).length : undefined },
        { id: "all", label: "All" },
      ]} />
      {!referrals ? <Spinner /> : !shown.length ? (
        <EmptyState icon={Rocket} title="Nothing here" text={tab === "review" ? "Startups that venture partners introduce appear here for review." : "No startup introductions in this list."} />
      ) : (
        <DataTable columns={["Startup", "Introduced by", "Sector", "Submitted", "Status", ""]}>
          {shown.map((r) => (
            <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: "pointer" }}>
              <td style={cellStyle}>
                <div style={{ fontWeight: 600 }}>{r.startup_name}</div>
                <Muted>{r.website.replace(/^https?:\/\//, "")} · {r.founder_name}</Muted>
              </td>
              <td style={cellStyle}>{r.partner_name}</td>
              <td style={cellStyle}>{r.sector || "—"}</td>
              <td style={cellStyle}>{dateStr(r.created_at)}</td>
              <td style={cellStyle}><StatusBadge status={r.status} colors={REFERRAL_STATUS_COLORS} /></td>
              <td style={cellStyle}>
                {r.possible_duplicates > 0 && ["Submitted", "Under review"].includes(r.status) && (
                  <span style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12, color: "#B8790A", fontWeight: 600 }}><AlertTriangle size={13} /> {r.possible_duplicates} possible duplicate{r.possible_duplicates === 1 ? "" : "s"}</span>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {openId && <ReferralDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} onOpenDeal={onOpenDeal} />}
    </div>
  );
}
