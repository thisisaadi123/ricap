// One login per browser (a user is admin, partner or investor), same as
// RISE. The session token is kept in localStorage and expires after 8 hours
// on the server side.
const TOKEN_KEY = "ricap-token";
const USER_KEY = "ricap-user";

// Local dev: Vite proxies /api to the backend. Production: same origin via
// the Netlify redirect, so this stays empty unless the API lives elsewhere.
const API_BASE = import.meta.env.VITE_API_URL || "";

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Called when the server says the session is no longer valid (expired,
// suspended). App.jsx sets this to send the user back to sign-in.
let onSessionExpired = () => {};
export function setSessionExpiredHandler(fn) { onSessionExpired = fn; }

async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith("/auth/")) onSessionExpired();
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.restart = Boolean(data.restart);
    throw err;
  }
  return data;
}

export const api = {
  // auth
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
  verifyCode: (challengeId, code) => request("/auth/verify-code", { method: "POST", body: { challengeId, code } }),
  resendCode: (challengeId) => request("/auth/resend-code", { method: "POST", body: { challengeId } }),
  me: () => request("/auth/me"),
  getInvite: (token) => request(`/auth/invite?token=${encodeURIComponent(token)}`),
  acceptInvite: (token, password) => request("/auth/accept-invite", { method: "POST", body: { token, password } }),
  forgotPassword: (email) => request("/auth/forgot", { method: "POST", body: { email } }),
  resetPassword: (token, password) => request("/auth/reset", { method: "POST", body: { token, password } }),

  // admin
  listUsers: () => request("/admin/users"),
  inviteUser: (body) => request("/admin/users", { method: "POST", body }),
  resendInvite: (id) => request(`/admin/users/${id}/resend-invite`, { method: "POST" }),
  setUserStatus: (id, status) => request(`/admin/users/${id}/status`, { method: "PATCH", body: { status } }),
  listAudit: (limit = 200) => request(`/admin/audit?limit=${limit}`),
};
