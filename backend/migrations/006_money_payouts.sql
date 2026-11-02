-- M5: partner payouts, RIV's own investments into startups, money view
-- (PRD 6.9, 7, 8.8, 8.9, 8.12, 9.2; VP-1, VP-2, BIZ-5, LEG-11).

ALTER TABLE documents DROP CONSTRAINT documents_linked_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_linked_type_check
  CHECK (linked_type IN ('investor', 'partner', 'kyc_item', 'kyc_ubo', 'template', 'commitment', 'vehicle', 'payout', 'outbound'));

-- UAE VAT on partner payouts (LEG-11). Per partner, because treatment can
-- differ for partners who aren't VAT-registered in the UAE.
ALTER TABLE venture_partners ADD COLUMN payout_vat_pct NUMERIC(5,2) NOT NULL DEFAULT 5 CHECK (payout_vat_pct BETWEEN 0 AND 100);

-- Numeric settings an admin can change.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value NUMERIC NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Payouts above this total need a second admin (PRD 9.2). The PRD leaves
-- the amount configurable; this default is a placeholder to confirm.
INSERT INTO app_settings (key, value) VALUES ('payout_second_admin_above', 50000);

-- One payout per credited commitment (PRD 6.9, 8.12).
CREATE TABLE partner_payouts (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES venture_partners(id),
  commitment_id INTEGER NOT NULL UNIQUE REFERENCES commitments(id),
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  flow TEXT NOT NULL CHECK (flow IN ('HoldCo', 'Fund', 'IB')),
  status TEXT NOT NULL DEFAULT 'Accruing' CHECK (status IN ('Accruing', 'Earned', 'Approved', 'Paid', 'Cancelled')),
  -- HoldCo / Fund: capital raised. IB: RIV's consideration on this
  -- placement (cash fee + share of sweat-equity value).
  basis_amount NUMERIC(14,2) NOT NULL,
  cash_fee_part NUMERIC(14,2),
  sweat_value_part NUMERIC(14,2),
  pct NUMERIC(5,2) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  vat_pct NUMERIC(5,2) NOT NULL,
  vat_amount NUMERIC(14,2) NOT NULL,
  total NUMERIC(14,2) NOT NULL,
  over_cash_flag BOOLEAN NOT NULL DEFAULT false,
  over_cash_reason TEXT,
  earned_at TIMESTAMPTZ,
  first_approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  first_approved_at TIMESTAMPTZ,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  cancel_reason TEXT,
  cancelled_manually BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payouts_partner ON partner_payouts(partner_id);
CREATE INDEX idx_payouts_status ON partner_payouts(status);

-- RIV's investments into startups (PRD 8.9, BIZ-5). Source is the HoldCo
-- balance sheet in v1.
CREATE TABLE outbound_investments (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'Retail X HoldCo' CHECK (source IN ('Retail X HoldCo', 'Retail X Fund')),
  startup_name TEXT NOT NULL,
  rise_startup_id TEXT,
  instrument TEXT NOT NULL CHECK (instrument IN ('Equity', 'SAFE', 'Convertible', 'Other')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  investment_date DATE,
  stake_pct NUMERIC(6,3) CHECK (stake_pct BETWEEN 0 AND 100),
  valuation NUMERIC(14,2) CHECK (valuation > 0),
  status TEXT NOT NULL DEFAULT 'Proposed' CHECK (status IN ('Proposed', 'Approved', 'Funded', 'Exited', 'Written off', 'Cancelled')),
  status_reason TEXT,
  notes TEXT,
  proposed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE money_movements ADD COLUMN payout_id INTEGER REFERENCES partner_payouts(id);
ALTER TABLE money_movements ADD COLUMN outbound_investment_id INTEGER REFERENCES outbound_investments(id);
ALTER TABLE money_movements ADD COLUMN reconciled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE money_movements ADD COLUMN reconciled_at TIMESTAMPTZ;
