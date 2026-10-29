import React, { useState } from "react";
import { api } from "../../api.js";
import { BRAND, FONT } from "../../brand.js";
import { ErrorBanner, Field, LinkButton, PrimaryButton, SuccessBanner, inputStyle } from "../../components/ui.jsx";
import { AuthShell } from "./AuthShell.jsx";
import { SetPasswordForm } from "./SetPasswordForm.jsx";

export function ForgotPasswordView({ onGoToLogin }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const result = await api.forgotPassword(email.trim());
      setMessage(result.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Reset your password" footer={<LinkButton onClick={onGoToLogin}>Back to sign in</LinkButton>}>
      {message ? <SuccessBanner text={message} /> : (
        <form onSubmit={submit}>
          <ErrorBanner text={error} />
          <div style={{ fontFamily: FONT, fontSize: 13, color: BRAND.ink, marginBottom: 16, lineHeight: 1.55 }}>
            Enter the email you use for RICap and we'll send you a link to set a new password.
          </div>
          <Field label="Email" required>
            <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <PrimaryButton type="submit" disabled={loading} style={{ width: "100%", padding: "12px 18px" }}>
            {loading ? "Sending…" : "Send reset link"}
          </PrimaryButton>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordView({ token, onDone, onGoToLogin }) {
  return (
    <AuthShell title="Choose a new password" footer={<LinkButton onClick={onGoToLogin}>Back to sign in</LinkButton>}>
      <SetPasswordForm
        buttonLabel="Save new password"
        onSubmit={async (password) => {
          await api.resetPassword(token, password);
          onDone("Your password has been changed. Sign in with your new password.");
        }}
      />
    </AuthShell>
  );
}
