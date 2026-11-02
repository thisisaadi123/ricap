import React, { useCallback, useEffect, useState } from "react";
import { Copy, Mail, UserPlus, Users } from "lucide-react";
import { api } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import {
  DataTable, EmptyState, ErrorBanner, Field, GhostButton, Modal, PrimaryButton,
  Spinner, StatusBadge, SuccessBanner, cellStyle, dateStr, dateTimeStr, inputStyle, useSuccessMessage,
} from "../../components/ui.jsx";
import { ROLE_LABELS } from "../../components/NavBar.jsx";

export const USER_STATUS_COLORS = {
  invited: { bg: "#FFF4E0", fg: "#B8790A" },
  active: { bg: "#E6F4EA", fg: "#1E7A34" },
  suspended: { bg: "#FBEAEA", fg: BRAND.coralDark },
};

// When email isn't configured (local dev), the API hands back the invite
// link so the admin can copy it and share it another way.
export function InviteLinkNotice({ link }) {
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  return (
    <SuccessBanner text="Email isn't set up yet, so no email was sent. Copy this one-time link and send it to the user yourself:">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <code style={{ fontSize: 11.5, wordBreak: "break-all", background: "#fff", padding: "6px 8px", borderRadius: 6, border: `1px solid ${BRAND.line}`, flex: 1 }}>{link}</code>
        <GhostButton icon={Copy} style={{ padding: "6px 10px" }} onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy"}
        </GhostButton>
      </div>
    </SuccessBanner>
  );
}

function InviteUserModal({ onClose, onInvited }) {
  const [form, setForm] = useState({ name: "", email: "", role: "admin", company: "Retail Innovation Ventures" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(""); setSaving(true);
    try {
      const result = await api.inviteUser(form);
      onInvited(result);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Invite an admin" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBanner text={error} />
        <Field label="Full name" required>
          <input style={inputStyle} value={form.name} onChange={set("name")} required autoFocus />
        </Field>
        <Field label="Email" required>
          <input style={inputStyle} type="email" value={form.email} onChange={set("email")} required />
        </Field>
        <Field label="Company" hint="Optional.">
          <input style={inputStyle} value={form.company} onChange={set("company")} />
        </Field>
        <div style={{ fontFamily: FONT, fontSize: 12, color: MUTED, marginBottom: 16, lineHeight: 1.55 }}>
          They'll get an email with a one-time link (valid 72 hours) to set their password. Invite venture partners from the Partners page and investors from their contacts on the Investors page.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" icon={UserPlus} disabled={saving}>{saving ? "Inviting…" : "Send invite"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

export function AdminUsersView({ currentUser }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    api.listUsers().then((r) => setUsers(r.users)).catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  function handleInviteResult(result, name) {
    setInviteLink(result.inviteLink || "");
    if (result.emailSent) showSuccess(`Invite emailed to ${name}.`);
    else if (result.emailError) setError(`Invite created, but the email failed: ${result.emailError}`);
  }

  async function resend(u) {
    setBusyId(u.id); setError(""); setInviteLink("");
    try {
      handleInviteResult(await api.resendInvite(u.id), u.name);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleRestricted(u) {
    setBusyId(u.id); setError("");
    try {
      await api.setRestrictedAccess(u.id, !u.restricted_access);
      showSuccess(`${u.name} ${u.restricted_access ? "no longer has" : "now has"} restricted access.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleStatus(u) {
    const next = u.status === "suspended" ? "active" : "suspended";
    if (next === "suspended" && !window.confirm(`Suspend ${u.name}? They'll be signed out and can't sign in until reactivated.`)) return;
    setBusyId(u.id); setError("");
    try {
      await api.setUserStatus(u.id, next);
      showSuccess(`${u.name} ${next === "suspended" ? "suspended" : "reactivated"}.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <PrimaryButton icon={UserPlus} onClick={() => setShowInvite(true)}>Invite admin</PrimaryButton>
      </div>
      <ErrorBanner text={error} />
      <SuccessBanner text={success} />
      <InviteLinkNotice link={inviteLink} />

      {!users ? <Spinner /> : users.length === 0 ? (
        <EmptyState icon={Users} title="No users yet" text="Invite your first admin." />
      ) : (
        <DataTable columns={["Name", "Email", "Role", "Status", "Last sign-in", "Added", ""]}>
          {users.map((u) => (
            <tr key={u.id}>
              <td style={cellStyle}>
                <div style={{ fontWeight: 600 }}>{u.name}</div>
                {u.company && <div style={{ color: MUTED, fontSize: 11.5 }}>{u.company}</div>}
              </td>
              <td style={cellStyle}>{u.email}</td>
              <td style={cellStyle}>
                {ROLE_LABELS[u.role]}
                {u.role === "admin" && (
                  <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: MUTED, marginTop: 4 }} title="Can see KYC files and documents, and investor net worth">
                    <input type="checkbox" checked={u.restricted_access} disabled={u.id === currentUser.id || busyId === u.id} onChange={() => toggleRestricted(u)} />
                    Restricted access
                  </label>
                )}
              </td>
              <td style={cellStyle}>
                <StatusBadge status={u.status} colors={USER_STATUS_COLORS} label={u.status[0].toUpperCase() + u.status.slice(1)} />
                {u.status === "invited" && (
                  <div style={{ color: MUTED, fontSize: 11, marginTop: 4 }}>
                    {u.invite_expires_at ? `Link valid until ${dateStr(u.invite_expires_at)}` : "Link expired"}
                  </div>
                )}
              </td>
              <td style={cellStyle}>{dateTimeStr(u.last_login_at)}</td>
              <td style={cellStyle}>{dateStr(u.created_at)}</td>
              <td style={{ ...cellStyle, textAlign: "right" }}>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {u.status === "invited" && (
                    <GhostButton icon={Mail} disabled={busyId === u.id} onClick={() => resend(u)} style={{ padding: "6px 10px", fontSize: 12 }}>Resend invite</GhostButton>
                  )}
                  {u.id !== currentUser.id && (
                    <GhostButton disabled={busyId === u.id} onClick={() => toggleStatus(u)} style={{ padding: "6px 10px", fontSize: 12 }}>
                      {u.status === "suspended" ? "Reactivate" : "Suspend"}
                    </GhostButton>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      {showInvite && (
        <InviteUserModal
          onClose={() => setShowInvite(false)}
          onInvited={(result) => {
            setShowInvite(false);
            handleInviteResult(result, result.user.name);
            load();
          }}
        />
      )}
    </div>
  );
}
