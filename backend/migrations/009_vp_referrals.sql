-- M10: venture partner referrals. Extends investor introductions with the
-- fields from the Bigin VP Investor Referrals pipeline, and adds startup
-- introductions (a VP introduces a startup, RIV reviews it and may open an IB
-- deal draft from it). Additive only: nothing here changes an existing
-- column or rule.

-- Investor introduction: extra answers the VP gives. Consent reuses
-- investors.data_consent_at; "why referring" reuses investors.relationship_note;
-- the indicative investment size reuses ticket_min / ticket_max.
ALTER TABLE investors ADD COLUMN linkedin_url TEXT;
ALTER TABLE investors ADD COLUMN relationship_type TEXT
  CHECK (relationship_type IN ('Friend', 'Colleague', 'Mentor', 'Co-investor', 'Professional Network', 'Other'));
ALTER TABLE investors ADD COLUMN previously_invested TEXT CHECK (previously_invested IN ('Yes', 'No'));
ALTER TABLE investors ADD COLUMN personally_interacted TEXT CHECK (personally_interacted IN ('Yes', 'No'));
ALTER TABLE investors ADD COLUMN informed_about_riv TEXT CHECK (informed_about_riv IN ('Yes', 'No'));
ALTER TABLE investors ADD COLUMN intro_methods TEXT[] NOT NULL DEFAULT '{}'
  CHECK (intro_methods <@ ARRAY['Email', 'WhatsApp', 'LinkedIn', 'In person']);
ALTER TABLE investors ADD COLUMN expected_support TEXT
  CHECK (expected_support IN ('Initial introduction', 'Follow-up facilitation', 'Available as needed'));

-- A venture partner's introduction of a startup. The startup has no login
-- (IB-2); RIV admin reviews it. Accepting it credits the VP for their credit
-- window (VP-3), which is attribution only: it carries no payout.
CREATE TABLE startup_referrals (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES venture_partners(id),
  submitted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  startup_name TEXT NOT NULL,
  website TEXT NOT NULL,
  -- Lower-case host without "www.", for the duplicate check.
  website_domain TEXT NOT NULL,
  linkedin_url TEXT,
  description TEXT NOT NULL,
  problem_solved TEXT,
  founder_name TEXT NOT NULL,
  founder_email TEXT NOT NULL CHECK (founder_email = lower(founder_email)),
  startup_stage TEXT CHECK (startup_stage IN ('Idea', 'Pre-revenue', 'Early Revenue', 'Scaling')),
  sector TEXT CHECK (sector IN ('Retail Tech', 'Consumer Tech', 'Agri Tech', 'Health Tech', 'Fin Tech', 'Supply Chain & Logistics', 'Other')),
  fundraising TEXT CHECK (fundraising IN ('Yes', 'No', 'Exploring')),
  personally_interacted TEXT CHECK (personally_interacted IN ('Yes', 'No')),
  -- Stored for the RIV team only. RICap is not connected to RISE (IB-1).
  interested_in_rise_gtm TEXT CHECK (interested_in_rise_gtm IN ('Yes', 'No')),
  why_referring TEXT NOT NULL,
  -- The VP confirmed the founder agreed to be introduced to RIV.
  consent_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Under review', 'Accepted', 'Rejected', 'Duplicate')),
  rejection_reason TEXT,
  duplicate_of_referral_id INTEGER REFERENCES startup_referrals(id) ON DELETE SET NULL,
  duplicate_of_deal_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  -- Set on acceptance: now + the VP's credit window.
  credit_expires_at TIMESTAMPTZ,
  -- The IB deal draft opened from this referral, if any.
  deal_vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'Duplicate' OR duplicate_of_referral_id IS NOT NULL OR duplicate_of_deal_id IS NOT NULL)
);
CREATE INDEX idx_startup_referrals_partner ON startup_referrals(partner_id);
CREATE INDEX idx_startup_referrals_status ON startup_referrals(status);
CREATE INDEX idx_startup_referrals_domain ON startup_referrals(website_domain);
CREATE UNIQUE INDEX idx_startup_referrals_one_deal ON startup_referrals(deal_vehicle_id) WHERE deal_vehicle_id IS NOT NULL;

-- The VP who introduced the startup. Reference only: it does not change any
-- payout (partner payouts follow the investor who is placed, PRD 6.9).
ALTER TABLE ib_deals ADD COLUMN introduced_by_partner_id INTEGER REFERENCES venture_partners(id) ON DELETE SET NULL;
