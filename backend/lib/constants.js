// Picklists shared by routes and validation. Must match the CHECK
// constraints in migrations/002_people.sql and 003_kyc_documents.sql.

const INVESTOR_KINDS = ["Individual", "Entity"];
const INVESTOR_CATEGORIES = [
  "HNW individual", "Retail house / corporate development", "Family office",
  "Government / sovereign fund", "Pension fund", "Endowment", "Retail / consumer fund",
  "VC fund", "Angel / syndicate", "Corporate VC", "Other",
];
const DESTINATIONS = ["HoldCo", "Fund", "IB deals"];
const ADMIN_INVESTOR_SOURCES = ["RIV direct", "Event", "Inbound"];
const REGISTRATION_STATUSES = ["Submitted", "Approved", "Rejected", "Duplicate"];
const CONTACT_ROLES = ["Decision-maker", "Signatory", "Operations"];
const INCLINATIONS = ["High", "Medium", "Low", "Unknown"];

const PARTNER_STAGES = ["New", "Agreement Sent", "Signed", "Onboarded"];
const PARTNER_TIERS = ["Tier 1", "Tier 2", "Tier 3"];
const PARTNER_NETWORK_TYPES = ["HNW", "Family offices", "Corporates", "Institutions", "VC funds", "Syndicates"];

const KYC_FILE_STATUSES = ["Open", "Submitted", "Information requested", "Cleared", "Rejected"];
const KYC_ITEM_STATUSES = ["Requested", "Received", "Verified", "Rejected"];
const PEP_STATUSES = ["Not a PEP", "PEP", "Related to a PEP"];
const SANCTIONS_RESULTS = ["No match", "Potential match", "Confirmed match"];
const RISK_RATINGS = ["Low", "Medium", "High"];
const CLASSIFICATIONS = ["Retail client", "Professional client", "Market counterparty"];
const KYC_REFRESH_MONTHS = 12;

const DOC_TYPES = [
  "KYC document", "Venture Partner Agreement", "NDA", "Term sheet", "Subscription Agreement (SSA)",
  "Shareholders' Agreement (SHA)", "Investment agreement", "Engagement letter", "Teaser", "Board resolution",
  "Register extract", "Share certificate", "Allotment confirmation", "Funds confirmation", "Payment instruction",
  "Payment confirmation", "Bank proof", "Soft commitment confirmation", "Signed document", "Update", "Other",
];
const CONFIDENTIALITY = ["Restricted", "Internal", "Shareable with investor", "Shareable with partner"];
const SIGNATURE_STATUSES = ["Not required", "Sent", "Signed by counterparty", "Fully executed", "Signed offline"];
const DOC_SOURCES = ["Investor upload", "Admin upload", "Received by email", "Received in person"];
const TEMPLATE_STATUSES = ["Draft", "Active", "Retired"];

module.exports = {
  INVESTOR_KINDS, INVESTOR_CATEGORIES, DESTINATIONS, ADMIN_INVESTOR_SOURCES, REGISTRATION_STATUSES,
  CONTACT_ROLES, INCLINATIONS, PARTNER_STAGES, PARTNER_TIERS, PARTNER_NETWORK_TYPES,
  KYC_FILE_STATUSES, KYC_ITEM_STATUSES, PEP_STATUSES, SANCTIONS_RESULTS, RISK_RATINGS, CLASSIFICATIONS,
  KYC_REFRESH_MONTHS, DOC_TYPES, CONFIDENTIALITY, SIGNATURE_STATUSES, DOC_SOURCES, TEMPLATE_STATUSES,
};
