import React, { useState } from "react";
import { ErrorBanner, Field, PrimaryButton, inputStyle } from "../../components/ui.jsx";

export const MIN_PASSWORD_LENGTH = 10;

// Shared by accepting an invite and resetting a password.
export function SetPasswordForm({ onSubmit, buttonLabel }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setLoading(true);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ErrorBanner text={error} />
      <Field label="New password" required hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        <input style={inputStyle} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
      </Field>
      <Field label="Confirm password" required>
        <input style={inputStyle} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      <PrimaryButton type="submit" disabled={loading} style={{ width: "100%", padding: "12px 18px" }}>
        {loading ? "Saving…" : buttonLabel}
      </PrimaryButton>
    </form>
  );
}
