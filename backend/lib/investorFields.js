// Shared reading and display rules for investor records, used by the admin
// and partner routes.
const v = require("./validate.js");
const C = require("./constants.js");
const { httpError } = require("./http.js");

// KYC status shown on lists: the current KYC file's status, "Expired" once
// a cleared file passes its refresh date, or "Not started".
const KYC_STATUS_SQL = `
  CASE WHEN k.id IS NULL THEN 'Not started'
       WHEN k.status = 'Cleared' AND k.refresh_due < current_date THEN 'Expired'
       ELSE k.status END`;

const RESTRICTED_FIELDS = ["investment_inclination", "net_worth_band"];

function readInvestor(body, { partial, restricted = false }) {
  const out = {};
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(body, k);
  if (has("kind")) out.kind = v.oneOf(body.kind, C.INVESTOR_KINDS, "Investor kind", { required: true });
  if (has("legal_name")) out.legal_name = v.text(body.legal_name, "Legal name", { required: true, max: 300 });
  if (has("display_name")) out.display_name = v.text(body.display_name, "Display name", { max: 300 });
  if (has("company")) out.company = v.text(body.company, "Company", { max: 300 });
  if (has("category")) out.category = v.oneOf(body.category, C.INVESTOR_CATEGORIES, "Investor category", { required: true });
  if (has("country")) out.country = v.text(body.country, "Country", { max: 100 });
  if (has("ticket_min")) out.ticket_min = v.number(body.ticket_min, "Minimum ticket", { min: 0, max: 1e12 });
  if (has("ticket_max")) out.ticket_max = v.number(body.ticket_max, "Maximum ticket", { min: 0, max: 1e12 });
  if (has("destinations")) out.destinations = v.manyOf(body.destinations, C.DESTINATIONS, "Destinations of interest");
  if (has("relationship_note")) out.relationship_note = v.text(body.relationship_note, "Relationship note", { max: 4000 });
  if (has("notes")) out.notes = v.text(body.notes, "Notes", { max: 4000 });
  if (has("riv_owner_user_id")) out.riv_owner_user_id = body.riv_owner_user_id ? v.id(body.riv_owner_user_id, "RIV owner") : null;
  if (has("data_consent")) out.data_consent_at = v.bool(body.data_consent) ? new Date() : null;
  if (restricted) {
    if (has("investment_inclination")) out.investment_inclination = v.oneOf(body.investment_inclination, C.INCLINATIONS, "Investment inclination");
    if (has("net_worth_band")) out.net_worth_band = v.text(body.net_worth_band, "Net worth band", { max: 100 });
  } else if (RESTRICTED_FIELDS.some((f) => body[f] !== undefined && body[f] !== null && body[f] !== "")) {
    throw httpError(403, "Net worth and investment inclination need restricted access.");
  }
  if (out.ticket_min != null && out.ticket_max != null && out.ticket_min > out.ticket_max) {
    throw httpError(400, "Minimum ticket can't be more than the maximum.");
  }
  return out;
}

function readContact(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(body, k);
  if (has("name")) out.name = v.text(body.name, "Contact name", { required: true, max: 200 });
  if (has("email")) out.email = v.email(body.email, "Contact email");
  if (has("phone")) out.phone = v.text(body.phone, "Contact phone", { max: 50 });
  if (has("role")) out.role = v.oneOf(body.role || "Decision-maker", C.CONTACT_ROLES, "Contact role", { required: true });
  return out;
}

function stripRestricted(investor, restricted) {
  if (restricted) return investor;
  const copy = { ...investor };
  for (const f of RESTRICTED_FIELDS) delete copy[f];
  return copy;
}

module.exports = { KYC_STATUS_SQL, readInvestor, readContact, stripRestricted };
