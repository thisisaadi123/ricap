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
export function setStoredUser(user) {
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

// Matches backend/lib/documents.js.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

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
  if (file && file.size > MAX_UPLOAD_BYTES) throw new Error("That file is over 4 MB.");
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== "") fd.append(k, v);
  fd.append("file", file);
  return fd;
}

function query(params) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return q.toString() ? `?${q}` : "";
}

// Downloads a document through its 60-second link (PRD 9.2). A plain link
// click rather than a new tab: Safari blocks new tabs opened after waiting on
// the server, and these links always download.
export async function openDocument(id) {
  const { url, filename } = await request(`/documents/${id}/link`);
  const link = document.createElement("a");
  link.href = url.startsWith("/") ? `${API_BASE}${url}` : url;
  link.download = filename || "";
  document.body.appendChild(link);
  link.click();
  link.remove();
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
  listAudit: (limit = 200, q = "") => request(`/admin/audit${query({ limit, q })}`),

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
  // admin: startup referrals from venture partners (M10)
  listStartupReferrals: (params = {}) => request(`/admin/startup-referrals${query(params)}`),
  getStartupReferral: (id) => request(`/admin/startup-referrals/${id}`),
  reviewStartupReferral: (id, body) => request(`/admin/startup-referrals/${id}/review`, { method: "POST", body }),
  createDealFromReferral: (id, body) => request(`/admin/startup-referrals/${id}/create-deal`, { method: "POST", body }),
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

  listStageRequirements: () => request("/admin/templates/stage-requirements"),
  addStageRequirement: (body) => request("/admin/templates/stage-requirements", { method: "POST", body }),
  setStageRequirementRequired: (id, required) => request(`/admin/templates/stage-requirements/${id}`, { method: "PATCH", body: { required } }),

  // admin: vehicles (M3)
  listVehicles: () => request("/admin/vehicles"),
  getVehicle: (id) => request(`/admin/vehicles/${id}`),
  updateVehicle: (id, body) => request(`/admin/vehicles/${id}`, { method: "PATCH", body }),
  proposeBankChange: (id, body) => request(`/admin/vehicles/${id}/bank-changes`, { method: "POST", body }),
  decideBankChange: (changeId, decision, note) => request(`/admin/vehicles/bank-changes/${changeId}/${decision}`, { method: "POST", body: { note } }),
  hideVehicle: (id, investor_id) => request(`/admin/vehicles/${id}/hidden`, { method: "POST", body: { investor_id } }),
  unhideVehicle: (id, investorId) => request(`/admin/vehicles/${id}/hidden/${investorId}`, { method: "DELETE" }),

  // admin: commitments (M3)
  listCommitments: (params = {}) => request(`/admin/commitments${query(params)}`),
  getCommitment: (id) => request(`/admin/commitments/${id}`),
  createCommitment: (body) => request("/admin/commitments", { method: "POST", body }),
  updateCommitment: (id, body) => request(`/admin/commitments/${id}`, { method: "PATCH", body }),
  checkEligibility: (id) => request(`/admin/commitments/${id}/check-eligibility`, { method: "POST" }),
  overrideMinimum: (id, reason) => request(`/admin/commitments/${id}/override-minimum`, { method: "POST", body: { reason } }),
  advanceCommitment: (id, body) => request(`/admin/commitments/${id}/advance`, { method: "POST", body }),
  exitCommitment: (id, status, reason) => request(`/admin/commitments/${id}/exit`, { method: "POST", body: { status, reason } }),
  reopenCommitment: (id, note) => request(`/admin/commitments/${id}/reopen`, { method: "POST", body: { note } }),
  addCommitmentNote: (id, note) => request(`/admin/commitments/${id}/notes`, { method: "POST", body: { note } }),
  issueInstructions: (id, due_date) => request(`/admin/commitments/${id}/instructions`, { method: "POST", body: { due_date } }),
  voidInstructions: (id, iid, reason) => request(`/admin/commitments/${id}/instructions/${iid}/void`, { method: "POST", body: { reason } }),
  recordReceipt: (id, file, fields) => request(`/admin/commitments/${id}/receipts`, { method: "POST", form: formOf(file, fields) }),
  voidReceipt: (id, rid, reason) => request(`/admin/commitments/${id}/receipts/${rid}/void`, { method: "POST", body: { reason } }),
  softConfirmByEmail: (id, file) => request(`/admin/commitments/${id}/soft-confirm`, { method: "POST", form: formOf(file) }),
  dataRoom: (id, action) => request(`/admin/commitments/${id}/data-room/${action}`, { method: "POST" }),

  // admin: dashboards (M7)
  dashboardHome: (stuck_days) => request(`/admin/dashboard/home${query({ stuck_days })}`),
  dashboardCompliance: () => request("/admin/dashboard/compliance"),
  dashboardMoney: () => request("/admin/dashboard/money"),

  // admin: investor updates (M6)
  listUpdates: () => request("/admin/updates"),
  updateTargets: () => request("/admin/updates/targets"),
  updateAudience: (vehicle_id) => request(`/admin/updates/audience${query({ vehicle_id })}`),
  getUpdate: (id) => request(`/admin/updates/${id}`),
  createUpdate: (body) => request("/admin/updates", { method: "POST", body }),
  editUpdate: (id, body) => request(`/admin/updates/${id}`, { method: "PATCH", body }),
  publishUpdate: (id) => request(`/admin/updates/${id}/publish`, { method: "POST" }),
  withdrawUpdate: (id, reason) => request(`/admin/updates/${id}/withdraw`, { method: "POST", body: { reason } }),
  investorRecord: (id, as_of) => request(`/admin/updates/investor/${id}${query({ as_of })}`),

  // alerts, any role (M6)
  notifications: () => request("/notifications"),
  unreadNotifications: () => request("/notifications/unread"),
  readNotification: (id) => request(`/notifications/${id}/read`, { method: "POST" }),
  readAllNotifications: () => request("/notifications/read-all", { method: "POST" }),

  // admin: money (M5)
  listPayouts: () => request("/admin/money/payouts"),
  approvePayout: (id, over_cash_reason) => request(`/admin/money/payouts/${id}/approve`, { method: "POST", body: { over_cash_reason } }),
  payPayout: (id, file, fields) => request(`/admin/money/payouts/${id}/pay`, { method: "POST", form: formOf(file, fields) }),
  cancelPayout: (id, reason) => request(`/admin/money/payouts/${id}/cancel`, { method: "POST", body: { reason } }),
  listMovements: (params = {}) => request(`/admin/money/movements${query(params)}`),
  reconcileMovement: (id) => request(`/admin/money/movements/${id}/reconcile`, { method: "POST" }),
  voidMovement: (id, reason) => request(`/admin/money/movements/${id}/void`, { method: "POST", body: { reason } }),
  listOutbound: () => request("/admin/money/outbound"),
  createOutbound: (body) => request("/admin/money/outbound", { method: "POST", body }),
  approveOutbound: (id) => request(`/admin/money/outbound/${id}/approve`, { method: "POST" }),
  fundOutbound: (id, file, fields) => request(`/admin/money/outbound/${id}/fund`, { method: "POST", form: formOf(file, fields) }),
  setOutboundStatus: (id, status, reason) => request(`/admin/money/outbound/${id}/status`, { method: "POST", body: { status, reason } }),
  getMoneySettings: () => request("/admin/money/settings"),
  updateMoneySettings: (body) => request("/admin/money/settings", { method: "PATCH", body }),

  // admin: IB deals (M4)
  listDeals: () => request("/admin/deals"),
  getDeal: (id) => request(`/admin/deals/${id}`),
  createDeal: (body) => request("/admin/deals", { method: "POST", body }),
  updateDeal: (id, body) => request(`/admin/deals/${id}`, { method: "PATCH", body }),
  advanceDeal: (id, body) => request(`/admin/deals/${id}/advance`, { method: "POST", body }),
  closeDeal: (id, status, reason) => request(`/admin/deals/${id}/close`, { method: "POST", body: { status, reason } }),
  createInvoice: (id, body) => request(`/admin/deals/${id}/invoices`, { method: "POST", body }),
  sendInvoice: (iid) => request(`/admin/deals/invoices/${iid}/send`, { method: "POST" }),
  recordInvoicePayment: (iid, file, fields) => request(`/admin/deals/invoices/${iid}/payment`, { method: "POST", form: formOf(file, fields) }),
  voidInvoice: (iid, reason) => request(`/admin/deals/invoices/${iid}/void`, { method: "POST", body: { reason } }),

  // venture partner (M1)
  partnerMe: () => request("/partner/me"),
  partnerOpportunities: () => request("/partner/opportunities"),
  partnerCommitments: () => request("/partner/commitments"),
  partnerPropose: (body) => request("/partner/commitments", { method: "POST", body }),
  partnerPayouts: () => request("/partner/payouts"),
  partnerUpdates: () => request("/partner/updates"),
  partnerInvestors: () => request("/partner/investors"),
  partnerAddInvestor: (body) => request("/partner/investors", { method: "POST", body }),
  partnerStartups: () => request("/partner/startups"),
  partnerAddStartup: (body) => request("/partner/startups", { method: "POST", body }),

  // investor (M2)
  investorMe: () => request("/investor/me"),
  investorKyc: () => request("/investor/kyc"),
  investorUploadKyc: (itemId, file) => request(`/investor/kyc/items/${itemId}/upload`, { method: "POST", form: formOf(file) }),
  investorSubmitKyc: () => request("/investor/kyc/submit", { method: "POST" }),
  investorDocuments: () => request("/investor/documents"),
  investorOpportunities: () => request("/investor/opportunities"),
  investorInterest: (body) => request("/investor/interest", { method: "POST", body }),
  investorCommitments: () => request("/investor/commitments"),
  investorCommitment: (id) => request(`/investor/commitments/${id}`),
  investorConfirmSoft: (id) => request(`/investor/commitments/${id}/confirm-soft`, { method: "POST" }),
  investorUpdates: () => request("/investor/updates"),
  investorReadUpdate: (id) => request(`/investor/updates/${id}/read`, { method: "POST" }),
  investorStatement: (as_of) => request(`/investor/statement${query({ as_of })}`),
  investorProfile: () => request("/investor/profile"),
  investorSaveProfile: (body) => request("/investor/profile", { method: "PATCH", body }),
  investorCommitmentUpload: (id, file, kind) => request(`/investor/commitments/${id}/upload`, { method: "POST", form: formOf(file, { kind }) }),
};
