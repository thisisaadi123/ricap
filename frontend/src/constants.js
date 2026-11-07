// Picklists. Must match backend/lib/constants.js (kept as literals here,
// same approach as RISE's status lists).
import { BRAND } from "./brand.js";

export const INVESTOR_KINDS = ["Individual", "Entity"];
export const INVESTOR_CATEGORIES = [
  "HNW individual", "Retail house / corporate development", "Family office",
  "Government / sovereign fund", "Pension fund", "Endowment", "Retail / consumer fund",
  "VC fund", "Angel / syndicate", "Corporate VC", "Other",
];
export const DESTINATIONS = ["HoldCo", "Fund", "IB deals"];
export const ADMIN_INVESTOR_SOURCES = ["RIV direct", "Event", "Inbound"];
export const CONTACT_ROLES = ["Decision-maker", "Signatory", "Operations"];
export const INCLINATIONS = ["High", "Medium", "Low", "Unknown"];
export const PARTNER_STAGES = ["New", "Agreement Sent", "Signed", "Onboarded"];
export const PARTNER_TIERS = ["Tier 1", "Tier 2", "Tier 3"];
export const PARTNER_NETWORK_TYPES = ["HNW", "Family offices", "Corporates", "Institutions", "VC funds", "Syndicates"];

export const PEP_STATUSES = ["Not a PEP", "PEP", "Related to a PEP"];
export const SANCTIONS_RESULTS = ["No match", "Potential match", "Confirmed match"];
export const RISK_RATINGS = ["Low", "Medium", "High"];
export const CLASSIFICATIONS = ["Retail client", "Professional client", "Market counterparty"];
export const DOC_TYPES = [
  "KYC document", "Venture Partner Agreement", "NDA", "Term sheet", "Subscription Agreement (SSA)",
  "Shareholders' Agreement (SHA)", "Investment agreement", "Engagement letter", "Teaser", "Board resolution",
  "Register extract", "Share certificate", "Allotment confirmation", "Funds confirmation", "Payment instruction",
  "Payment confirmation", "Bank proof", "Soft commitment confirmation", "Signed document", "Update", "Other",
];

// Commitment flows (must match backend/lib/commitments.js).
export const FLOWS = {
  HoldCo: ["Intent", "Eligible", "Offer documents issued", "Signed by investor", "Fully executed", "Funds due", "Funds received", "Shares issued", "Active shareholder"],
  Fund: ["Intent", "Eligible", "Soft commitment", "Soft commitment confirmed", "Awaiting Fund launch"],
  IB: ["Intent", "Eligible", "NDA signed", "Diligence", "Term sheet", "Definitive documents signed", "Funds transferred", "Closed"],
};
// RICap moves to these by itself, so they can't have document rules.
export const AUTOMATIC_STAGES = ["Funds due", "Funds received", "Soft commitment confirmed"];
export function stageLabel(flow, stage) {
  return flow === "IB" && stage === "Intent" ? "Interest expressed" : stage;
}
export const EXIT_STATUSES = ["On hold", "Dropped", "Rejected", "Withdrawn"];
export const VEHICLE_STATUSES = ["Draft", "Open", "Closed"];
export const SIGNATURE_STATUSES = ["Not required", "Sent", "Signed by counterparty", "Fully executed", "Signed offline"];

const AMBER = { bg: "#FFF4E0", fg: "#B8790A" };
const BLUE = { bg: "#E8F0FE", fg: BRAND.blue };
const GREEN = { bg: "#E6F4EA", fg: "#1E7A34" };
const RED = { bg: "#FBEAEA", fg: BRAND.coralDark };
const GREY = { bg: "#F3F1EE", fg: "#8A857F" };
const PURPLE = { bg: "#EFE9FB", fg: "#6B3FBF" };

export const REGISTRATION_COLORS = { Submitted: AMBER, Approved: GREEN, Rejected: RED, Duplicate: GREY, "Not accepted": GREY };
export const PARTNER_STAGE_COLORS = { New: GREY, "Agreement Sent": AMBER, Signed: BLUE, Onboarded: GREEN };
export const KYC_COLORS = {
  "Not started": GREY, Open: BLUE, Submitted: PURPLE, "Information requested": AMBER,
  Cleared: GREEN, Rejected: RED, Expired: RED,
};
export const KYC_ITEM_COLORS = { Requested: GREY, Received: PURPLE, Verified: GREEN, Rejected: RED };
export const SIGNATURE_COLORS = { "Not required": GREY, Sent: AMBER, "Signed by counterparty": BLUE, "Fully executed": GREEN, "Signed offline": GREEN };
export const TEMPLATE_COLORS = { Draft: AMBER, Active: GREEN, Retired: GREY };
export const RISK_COLORS = { Low: GREEN, Medium: AMBER, High: RED };

export const COMMITMENT_STATUS_COLORS = { Active: GREEN, "On hold": AMBER, Dropped: GREY, Rejected: RED, Withdrawn: GREY };
export const VEHICLE_STATUS_COLORS = { Draft: GREY, Open: GREEN, Closed: GREY };
export const BANK_CHANGE_COLORS = { Pending: AMBER, Approved: GREEN, Rejected: RED, Cancelled: GREY };

// Venture partner referrals (must match backend/lib/referrals.js and
// migrations/009_vp_referrals.sql).
export const YES_NO = ["Yes", "No"];
export const RELATIONSHIP_TYPES = ["Friend", "Colleague", "Mentor", "Co-investor", "Professional Network", "Other"];
export const INTRO_METHODS = ["Email", "WhatsApp", "LinkedIn", "In person"];
export const EXPECTED_SUPPORT = ["Initial introduction", "Follow-up facilitation", "Available as needed"];
export const STARTUP_STAGES = ["Idea", "Pre-revenue", "Early Revenue", "Scaling"];
export const STARTUP_SECTORS = ["Retail Tech", "Consumer Tech", "Agri Tech", "Health Tech", "Fin Tech", "Supply Chain & Logistics", "Other"];
export const FUNDRAISING = ["Yes", "No", "Exploring"];
export const DEAL_INSTRUMENTS = ["Equity", "SAFE", "Convertible", "Other"];
export const REFERRAL_STATUSES = ["Submitted", "Under review", "Accepted", "Rejected", "Duplicate"];

// What a venture partner sees (investors and startups they introduced).
export const VP_INVESTOR_STATUSES = ["Submitted", "Accepted", "In progress", "Invested", "Not accepted"];
export const VP_STARTUP_STATUSES = ["Submitted", "Under review", "Accepted", "Live", "Closed", "Not accepted"];
export const VP_STATUS_COLORS = {
  Submitted: AMBER, "Under review": PURPLE, Accepted: BLUE, "In progress": PURPLE, Invested: GREEN, Live: GREEN, Closed: GREY, "Not accepted": GREY,
};
export const REFERRAL_STATUS_COLORS = { Submitted: AMBER, "Under review": PURPLE, Accepted: GREEN, Rejected: RED, Duplicate: GREY };
