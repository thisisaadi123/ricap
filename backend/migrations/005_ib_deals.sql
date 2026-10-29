-- M4: IB deals (Capital Advisory), the investor side of a deal, data-room
-- access and fee invoices (PRD 6.8, 7, 8.5, 8.11; BIZ-3, MON-1, MON-7,
-- LEG-11).

-- Deal fields on top of the vehicle row (PRD 8.5: "IB Deal extends
-- Vehicle"). vehicles.status mirrors the deal: Draft until Live, Open while
-- Live, Closed once closed or withdrawn.
CREATE TABLE ib_deals (
  vehicle_id INTEGER PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  startup_name TEXT NOT NULL,
  -- Reference only; RICap and RISE aren't connected in v1 (IB-1).
  rise_startup_id TEXT,
  sector TEXT,
  instrument TEXT NOT NULL CHECK (instrument IN ('Equity', 'SAFE', 'Convertible', 'Other')),
  round_size NUMERIC(14,2) NOT NULL CHECK (round_size > 0),
  pre_money_valuation NUMERIC(14,2) NOT NULL CHECK (pre_money_valuation > 0),
  riv_allocation NUMERIC(14,2) CHECK (riv_allocation > 0),
  -- RIV's cash success fee, % of capital placed (MON-7: paid by the startup).
  fee_pct NUMERIC(5,2) NOT NULL DEFAULT 5 CHECK (fee_pct BETWEEN 0 AND 100),
  -- Any part of RIV's fee taken as equity, valued at pre-money (BIZ-3, VP-1).
  sweat_equity_pct NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (sweat_equity_pct BETWEEN 0 AND 100),
  exclusivity BOOLEAN NOT NULL DEFAULT false,
  term_start DATE,
  term_end DATE,
  below_floor_reason TEXT,
  -- Investor money goes straight to the startup in v1 (MON-1).
  funds_route TEXT NOT NULL DEFAULT 'Direct to startup' CHECK (funds_route IN ('Direct to startup')),
  data_room_url TEXT,
  startup_contact_name TEXT,
  startup_contact_email TEXT,
  deal_status TEXT NOT NULL DEFAULT 'Sourced' CHECK (deal_status IN ('Sourced', 'Mandate signed', 'Live', 'Closed', 'Withdrawn')),
  mandate_signed_date DATE,
  live_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (term_end IS NULL OR term_start IS NULL OR term_end >= term_start)
);

-- Investor side of a deal (PRD 6.8.2).
ALTER TABLE commitments ADD COLUMN funds_transferred_amount NUMERIC(14,2) CHECK (funds_transferred_amount > 0);
ALTER TABLE commitments ADD COLUMN funds_transferred_date DATE;
ALTER TABLE commitments ADD COLUMN data_room_granted_at TIMESTAMPTZ;

-- Data-room access log (PRD 6.8.2 stage 3: "access granted and logged").
CREATE TABLE deal_access_log (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('Granted', 'Revoked')),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fee invoices from Retail X HoldCo to the startup (PRD 8.11): fee % of
-- capital placed plus UAE VAT (LEG-11).
CREATE SEQUENCE fee_invoice_seq;
CREATE TABLE fee_invoices (
  id SERIAL PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  capital_placed NUMERIC(14,2) NOT NULL CHECK (capital_placed > 0),
  fee_pct NUMERIC(5,2) NOT NULL,
  fee_amount NUMERIC(14,2) NOT NULL,
  vat_pct NUMERIC(5,2) NOT NULL DEFAULT 5 CHECK (vat_pct BETWEEN 0 AND 100),
  vat_amount NUMERIC(14,2) NOT NULL,
  total NUMERIC(14,2) NOT NULL,
  issued_from TEXT NOT NULL DEFAULT 'Retail X HoldCo',
  billed_to TEXT NOT NULL,
  issue_date DATE NOT NULL DEFAULT current_date,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Sent', 'Paid', 'Void')),
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  void_reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (due_date >= issue_date)
);
-- Which invoice billed each investor's placement (each is billed once).
ALTER TABLE commitments ADD COLUMN invoice_id INTEGER REFERENCES fee_invoices(id);
ALTER TABLE money_movements ADD COLUMN invoice_id INTEGER REFERENCES fee_invoices(id);

-- Evidence for IB commitments and for the deal itself (editable on the
-- Settings > Stage evidence page).
INSERT INTO stage_requirements (flow, stage, label, doc_type, sort_order) VALUES
  ('IB', 'NDA signed', 'Signed NDA', 'NDA', 10),
  ('IB', 'Term sheet', 'Term sheet between investor and startup', 'Term sheet', 10),
  ('IB', 'Definitive documents signed', 'Executed investment agreement (SSA/SHA, SAFE or convertible)', 'Investment agreement', 10),
  ('IB', 'Funds transferred', 'Startup''s confirmation that the money arrived', 'Funds confirmation', 10),
  ('IB', 'Closed', 'Allotment confirmation or share certificate', 'Allotment confirmation', 10),
  ('IB deal', 'Mandate signed', 'Signed engagement letter', 'Engagement letter', 10),
  ('IB deal', 'Live', 'Approved teaser', 'Teaser', 10);
