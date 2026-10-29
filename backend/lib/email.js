// Transactional email via Resend's HTTP API, same approach as RISE: calls
// the REST endpoint with built-in fetch, so no SDK dependency. Needs
// RESEND_API_KEY and EMAIL_FROM (see backend/.env.example).
//
// If either is unset, sendEmail() resolves with { skipped: true } instead of
// throwing. Callers decide what that means: in local dev the login code or
// link is printed to the terminal; in production, sign-in refuses to
// continue, because a code nobody receives would lock everyone out.
const RESEND_URL = "https://api.resend.com/emails";

function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

async function sendEmail({ to, subject, text, html }) {
  if (!emailConfigured()) {
    console.warn(`Email not sent (RESEND_API_KEY/EMAIL_FROM not configured): "${subject}" -> ${to}`);
    return { skipped: true };
  }

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `RICap Portal <${process.env.EMAIL_FROM}>`,
      to: [to],
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  });

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch {}
    throw new Error(`Email send failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return { sent: true };
}

function appUrl(pathAndQuery) {
  const base = (process.env.APP_URL || "http://localhost:5190").replace(/\/$/, "");
  return `${base}${pathAndQuery}`;
}

async function sendLoginCode({ to, name, code }) {
  const result = await sendEmail({
    to,
    subject: `${code} is your RICap sign-in code`,
    text: `Hi ${name},\n\nYour RICap sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't try to sign in, you can ignore this email, but consider resetting your password.\n\nRetail Innovation Ventures`,
  });
  if (result.skipped && !isProduction()) console.log(`[dev] Login code for ${to}: ${code}`);
  return result;
}

async function sendInvite({ to, name, role, link }) {
  const roleLabel = role === "partner" ? "venture partner" : role;
  const result = await sendEmail({
    to,
    subject: "You're invited to RICap, Retail Innovation Ventures' capital portal",
    text: `Hi ${name},\n\nRetail Innovation Ventures has invited you to RICap as ${roleLabel === "admin" ? "an admin" : `a ${roleLabel}`}.\n\nSet your password here (the link works once and expires in 72 hours):\n${link}\n\nRetail Innovation Ventures`,
  });
  if (result.skipped && !isProduction()) console.log(`[dev] Invite link for ${to}: ${link}`);
  return result;
}

async function sendPasswordReset({ to, name, link }) {
  const result = await sendEmail({
    to,
    subject: "Reset your RICap password",
    text: `Hi ${name},\n\nUse this link to set a new RICap password. It works once and expires in 1 hour:\n${link}\n\nIf you didn't ask for this, you can ignore this email.\n\nRetail Innovation Ventures`,
  });
  if (result.skipped && !isProduction()) console.log(`[dev] Password reset link for ${to}: ${link}`);
  return result;
}

module.exports = { sendEmail, sendLoginCode, sendInvite, sendPasswordReset, appUrl, emailConfigured, isProduction };
