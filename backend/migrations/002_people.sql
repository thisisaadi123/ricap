-- M1 People: venture partners, investors, investor contacts and Bigin
-- imports (PRD 6.1-6.3, 8.1, 8.2). Enriched retail profile fields arrive
-- with M8.

-- Restricted data (investor net worth / inclination, KYC files and
-- documents) is visible only to admins with this flag (PRD 7, 8.2, 9.1).
ALTER TABLE users ADD COLUMN restricted_access BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE venture_partners (
  id SERIAL PRIMARY KEY,
  -- Set when the partner's RICap login is provisioned.
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  company TEXT,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  phone TEXT,
  linkedin_url TEXT,
  regions TEXT[] NOT NULL DEFAULT '{}',
  sectors TEXT[] NOT NULL DEFAULT '{}',
  tier TEXT CHECK (tier IN ('Tier 1', 'Tier 2', 'Tier 3')),
  investor_reach_count INTEGER CHECK (investor_reach_count >= 0),
  investor_network_types TEXT[] NOT NULL DEFAULT '{}',
  retail_network TEXT,
  profile_summary TEXT,
  onboarding_stage TEXT NOT NULL DEFAULT 'New'
    CHECK (onboarding_stage IN ('New', 'Agreement Sent', 'Signed', 'Onboarded')),
  agreement_link TEXT,
  agreement_signed_date DATE,
  -- Payout terms per agreement (VP-1 defaults): % of capital raised for
  -- HoldCo and Fund; % of RIV's total IB consideration for IB deals.
  payout_holdco_pct NUMERIC(5,2) NOT NULL DEFAULT 4 CHECK (payout_holdco_pct BETWEEN 0 AND 100),
  payout_fund_pct NUMERIC(5,2) NOT NULL DEFAULT 4 CHECK (payout_fund_pct BETWEEN 0 AND 100),
  payout_ib_pct NUMERIC(5,2) NOT NULL DEFAULT 15 CHECK (payout_ib_pct BETWEEN 0 AND 100),
  credit_window_months INTEGER NOT NULL DEFAULT 12 CHECK (credit_window_months BETWEEN 0 AND 120),
  riv_owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  source TEXT NOT NULL DEFAULT 'Manual' CHECK (source IN ('Manual', 'Bigin import')),
  bigin_id TEXT UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE investors (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('Individual', 'Entity')),
  legal_name TEXT NOT NULL,
  display_name TEXT,
  company TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'HNW individual', 'Retail house / corporate development', 'Family office',
    'Government / sovereign fund', 'Pension fund', 'Endowment', 'Retail / consumer fund',
    'VC fund', 'Angel / syndicate', 'Corporate VC', 'Other'
  )),
  country TEXT,
  ticket_min NUMERIC(14,2) CHECK (ticket_min >= 0),
  ticket_max NUMERIC(14,2) CHECK (ticket_max >= 0),
  destinations TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL CHECK (source IN ('Partner', 'RIV direct', 'Event', 'Inbound', 'Bigin import')),
  -- The venture partner who gets credit (PRD 6.2, VP-3). NULL for RIV-direct.
  partner_id INTEGER REFERENCES venture_partners(id) ON DELETE SET NULL,
  relationship_note TEXT,
  registration_status TEXT NOT NULL DEFAULT 'Submitted'
    CHECK (registration_status IN ('Submitted', 'Approved', 'Rejected', 'Duplicate')),
  rejection_reason TEXT,
  duplicate_of_investor_id INTEGER REFERENCES investors(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  credit_expires_at TIMESTAMPTZ,
  -- Restricted (TECH-1): only admins with restricted_access see these.
  investment_inclination TEXT CHECK (investment_inclination IN ('High', 'Medium', 'Low', 'Unknown')),
  net_worth_band TEXT,
  data_consent_at TIMESTAMPTZ,
  riv_owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  bigin_id TEXT UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ticket_min IS NULL OR ticket_max IS NULL OR ticket_min <= ticket_max),
  CHECK (source <> 'Partner' OR partner_id IS NOT NULL)
);

CREATE TABLE investor_contacts (
  id SERIAL PRIMARY KEY,
  investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT CHECK (email = lower(email)),
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'Decision-maker' CHECK (role IN ('Decision-maker', 'Signatory', 'Operations')),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  -- Set when RIV invites this contact to the investor portal (INV-6).
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bigin_imports (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('investors', 'partners')),
  filename TEXT,
  row_count INTEGER NOT NULL,
  created_count INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL,
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_investors_partner ON investors(partner_id);
CREATE INDEX idx_investors_status ON investors(registration_status);
CREATE INDEX idx_investors_legal_name ON investors(lower(legal_name));
CREATE INDEX idx_investor_contacts_investor ON investor_contacts(investor_id);
CREATE INDEX idx_investor_contacts_email ON investor_contacts(email);
CREATE UNIQUE INDEX idx_investor_one_primary ON investor_contacts(investor_id) WHERE is_primary;
