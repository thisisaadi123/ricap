import React, { useEffect, useState } from "react";
import { api } from "../../api.js";
import { BRAND, FONT } from "../../brand.js";
import { ErrorBanner, LinkButton, Spinner } from "../../components/ui.jsx";
import { ROLE_LABELS } from "../../components/NavBar.jsx";
import { AuthShell } from "./AuthShell.jsx";
import { SetPasswordForm } from "./SetPasswordForm.jsx";

export function AcceptInviteView({ token, onDone, onGoToLogin }) {
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getInvite(token).then((r) => setInvite(r.invite)).catch((err) => setError(err.message));
  }, [token]);

  if (error) {
    return (
      <AuthShell title="Invite link" footer={<LinkButton onClick={onGoToLogin}>Go to sign in</LinkButton>}>
        <ErrorBanner text={error} />
      </AuthShell>
    );
  }
  if (!invite) return <AuthShell title="Invite link"><Spinner label="Checking your invite…" /></AuthShell>;

  return (
    <AuthShell title={`Welcome, ${invite.name}`} subtitle={`You've been invited to RICap as ${ROLE_LABELS[invite.role]}`}>
      <div style={{ fontFamily: FONT, fontSize: 13, color: BRAND.ink, marginBottom: 18, lineHeight: 1.55 }}>
        Set a password for <strong>{invite.email}</strong>. After that, you'll sign in with this password and a code we email you each time.
      </div>
      <SetPasswordForm
        buttonLabel="Set password"
        onSubmit={async (password) => {
          await api.acceptInvite(token, password);
          onDone("Your password is set. Sign in to continue.");
        }}
      />
    </AuthShell>
  );
}
