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

// `form` sends a FormData body (file uploads); the browser sets the
// multipart Content-Type itself.
async function request(path, { method = "GET", body, form } = {}) {
  const headers = form ? {} : { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });

  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith("/auth/")) onSessionExpired();
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.restart = Boolean(data.restart);
    err.data = data;
    throw err;
  }
  return data;
}

function formOf(file, fields = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== "") fd.append(k, v);
  fd.append("file", file);
  return fd;
}

function query(params) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return q.toString() ? `?${q}` : "";
}

// Opens a document through its 60-second link (PRD 9.2).
export async function openDocument(id) {
  const { url } = await request(`/documents/${id}/link`);
  window.open(url.startsWith("/") ? `${API_BASE}${url}` : url, "_blank", "noopener");
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
  setRestrictedAccess: (id, restricted_access) => request(`/admin/users/${id}/restricted`, { method: "PATCH", body: { restricted_access } }),
  listAudit: (limit = 200) => request(`/admin/audit?limit=${limit}`),

  // admin: venture partners (M1)
  listPartners: () => request("/admin/partners"),
  getPartner: (id) => request(`/admin/partners/${id}`),
  createPartner: (body) => request("/admin/partners", { method: "POST", body }),
  updatePartner: (id, body) => request(`/admin/partners/${id}`, { method: "PATCH", body }),
  invitePartner: (id) => request(`/admin/partners/${id}/invite`, { method: "POST" }),

  // admin: investors (M1)
  listInvestors: (params = {}) => request(`/admin/investors${query(params)}`),
  getInvestor: (id) => request(`/admin/investors/${id}`),
  createInvestor: (body) => request("/admin/investors", { method: "POST", body }),
  updateInvestor: (id, body) => request(`/admin/investors/${id}`, { method: "PATCH", body }),
  reviewInvestor: (id, body) => request(`/admin/investors/${id}/review`, { method: "POST", body }),
  addContact: (id, body) => request(`/admin/investors/${id}/contacts`, { method: "POST", body }),
  updateContact: (id, contactId, body) => request(`/admin/investors/${id}/contacts/${contactId}`, { method: "PATCH", body }),
  removeContact: (id, contactId) => request(`/admin/investors/${id}/contacts/${contactId}`, { method: "DELETE" }),
  inviteContact: (id, contactId) => request(`/admin/investors/${id}/contacts/${contactId}/invite`, { method: "POST" }),

  // admin: Bigin import (M1)
  previewImport: (kind, csv, filename) => request("/admin/import/preview", { method: "POST", body: { kind, csv, filename } }),
  runImport: (kind, csv, filename) => request("/admin/import/run", { method: "POST", body: { kind, csv, filename } }),
  importHistory: () => request("/admin/import/history"),

  // admin: KYC (M2)
  listKyc: (status) => request(`/admin/kyc${query({ status })}`),
  openKyc: (investor_id) => request("/admin/kyc/open", { method: "POST", body: { investor_id } }),
  getKyc: (id) => request(`/admin/kyc/${id}`),
  updateKyc: (id, body) => request(`/admin/kyc/${id}`, { method: "PATCH", body }),
  addKycItem: (id, body) => request(`/admin/kyc/${id}/items`, { method: "POST", body }),
  uploadKycItem: (id, itemId, file, source) => request(`/admin/kyc/${id}/items/${itemId}/upload`, { method: "POST", form: formOf(file, { source }) }),
  reviewKycItem: (id, itemId, body) => request(`/admin/kyc/${id}/items/${itemId}/review`, { method: "POST", body }),
  addUbo: (id, body) => request(`/admin/kyc/${id}/ubos`, { method: "POST", body }),
  removeUbo: (id, uboId) => request(`/admin/kyc/${id}/ubos/${uboId}`, { method: "DELETE" }),
  decideKyc: (id, body) => request(`/admin/kyc/${id}/decision`, { method: "POST", body }),

  // admin: documents and templates (M2)
  listDocuments: (linked_type, linked_id) => request(`/admin/documents${query({ linked_type, linked_id })}`),
  uploadDocument: (file, fields) => request("/admin/documents", { method: "POST", form: formOf(file, fields) }),
  updateDocument: (id, body) => request(`/admin/documents/${id}`, { method: "PATCH", body }),
  uploadDocumentVersion: (id, file, signature_status) => request(`/admin/documents/${id}/version`, { method: "POST", form: formOf(file, { signature_status }) }),
  voidDocument: (id, reason) => request(`/admin/documents/${id}/void`, { method: "POST", body: { reason } }),
  listChecklist: () => request("/admin/templates/kyc-checklist"),
  addChecklistItem: (body) => request("/admin/templates/kyc-checklist", { method: "POST", body }),
  updateChecklistItem: (id, body) => request(`/admin/templates/kyc-checklist/${id}`, { method: "PATCH", body }),
  listTemplates: () => request("/admin/templates/documents"),
  uploadTemplate: (file, fields) => request("/admin/templates/documents", { method: "POST", form: formOf(file, fields) }),
  setTemplateStatus: (id, status) => request(`/admin/templates/documents/${id}`, { method: "PATCH", body: { status } }),

  // venture partner (M1)
  partnerMe: () => request("/partner/me"),
  partnerInvestors: () => request("/partner/investors"),
  partnerAddInvestor: (body) => request("/partner/investors", { method: "POST", body }),

  // investor (M2)
  investorMe: () => request("/investor/me"),
  investorKyc: () => request("/investor/kyc"),
  investorUploadKyc: (itemId, file) => request(`/investor/kyc/items/${itemId}/upload`, { method: "POST", form: formOf(file) }),
  investorSubmitKyc: () => request("/investor/kyc/submit", { method: "POST" }),
  investorDocuments: () => request("/investor/documents"),
};
