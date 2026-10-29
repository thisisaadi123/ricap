import React, { useState } from "react";
import { MailCheck } from "lucide-react";
import { api, setSession } from "../../api.js";
import { BRAND, FONT, MUTED } from "../../brand.js";
import { ErrorBanner, Field, LinkButton, PrimaryButton, SuccessBanner, inputStyle } from "../../components/ui.jsx";
import { AuthShell } from "./AuthShell.jsx";

// Two steps: email + password, then the 6-digit code emailed to the user
// (MFA, PRD 9.2).
export function LoginView({ onAuthed, onForgot, notice }) {
  const [step, setStep] = useState("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  function backToPassword(message) {
    setStep("password");
    setChallenge(null);
    setCode("");
    setError(message || "");
    setInfo("");
  }

  async function submitPassword(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const result = await api.login(email.trim(), password);
      setChallenge(result);
      setPassword("");
      setStep("code");
    } catch (err) {
      setError(err.message || "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setError(""); setInfo(""); setLoading(true);
    try {
      const { token, user } = await api.verifyCode(challenge.challengeId, code);
      setSession(token, user);
      onAuthed(user);
    } catch (err) {
      if (err.restart) backToPassword(err.message);
      else setError(err.message || "That code didn't work.");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setError(""); setInfo("");
    try {
      const result = await api.resendCode(challenge.challengeId);
      setChallenge(result);
      setCode("");
      setInfo(`A new code is on its way to ${result.sentTo}.`);
    } catch (err) {
      if (err.restart) backToPassword(err.message);
      else setError(err.message);
    }
  }

  if (step === "code") {
    return (
      <AuthShell footer={<LinkButton onClick={() => backToPassword()}>Use a different account</LinkButton>}>
        <form onSubmit={submitCode}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 18 }}>
            <MailCheck size={18} color={BRAND.coral} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontFamily: FONT, fontSize: 13, color: BRAND.ink, lineHeight: 1.55 }}>
              We emailed a 6-digit code to <strong>{challenge.sentTo}</strong>. It expires in 10 minutes.
            </div>
          </div>
          <ErrorBanner text={error} />
          <SuccessBanner text={info} />
          <Field label="Sign-in code" required>
            <input
              style={{ ...inputStyle, fontSize: 20, letterSpacing: 8, textAlign: "center" }}
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </Field>
          <PrimaryButton type="submit" disabled={loading || code.length !== 6} style={{ width: "100%", padding: "12px 18px" }}>
            {loading ? "Checking…" : "Verify and sign in"}
          </PrimaryButton>
          <div style={{ textAlign: "center", marginTop: 14, fontFamily: FONT, fontSize: 12.5, color: MUTED }}>
            Didn't get it? <LinkButton onClick={resend}>Send a new code</LinkButton>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell footer={<LinkButton onClick={onForgot}>Forgot your password?</LinkButton>}>
      <form onSubmit={submitPassword}>
        <SuccessBanner text={notice} />
        <ErrorBanner text={error} />
        <Field label="Email" required>
          <input style={inputStyle} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password" required>
          <input style={inputStyle} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <PrimaryButton type="submit" disabled={loading} style={{ width: "100%", padding: "12px 18px" }}>
          {loading ? "Signing in…" : "Continue"}
        </PrimaryButton>
      </form>
    </AuthShell>
  );
}
