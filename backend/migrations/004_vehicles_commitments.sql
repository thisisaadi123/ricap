-- M3: vehicles, commitments and the HoldCo / Fund flows (PRD 6.5-6.7,
-- 6.13, 7, 8.4, 8.6, 8.8).

-- Documents can now belong to a commitment (evidence, documents to sign,
-- payment confirmations) or a vehicle (teasers). evidence_stage tags a
-- document as the evidence for one stage of a commitment.
ALTER TABLE documents DROP CONSTRAINT documents_linked_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_linked_type_check
  CHECK (linked_type IN ('investor', 'partner', 'kyc_item', 'kyc_ubo', 'template', 'commitment', 'vehicle'));
ALTER TABLE documents ADD COLUMN evidence_stage TEXT;

-- Investment vehicles (PRD 8.4). IB deals are vehicles too; their deal
-- fields arrive with M4.
CREATE TABLE vehicles (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('HoldCo', 'Fund', 'IB Deal')),
  name TEXT NOT NULL,
  legal_entity TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'DIFC',
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Open', 'Closed')),
  target_raise NUMERIC(14,2) CHECK (target_raise > 0),
  pre_money_valuation NUMERIC(14,2) CHECK (pre_money_valuation > 0),
  -- Minimum ticket per investor kind (PRD 7). NULL = no minimum.
  min_ticket_individual NUMERIC(14,2) CHECK (min_ticket_individual >= 0),
  min_ticket_entity NUMERIC(14,2) CHECK (min_ticket_entity >= 0),
  -- Empty = any KYC classification may invest.
  eligible_classifications TEXT[] NOT NULL DEFAULT '{}',
  summary TEXT,
  visible_to_partners BOOLEAN NOT NULL DEFAULT true,
  visible_to_investors BOOLEAN NOT NULL DEFAULT true,
  -- Receiving bank account. Only ever set by an approved change request
  -- (two admins, PRD 7), never edited directly.
  bank_name TEXT,
  bank_account_name TEXT,
  bank_iban TEXT,
  bank_swift TEXT,
  bank_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bank_account_changes (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  bank_account_name TEXT NOT NULL,
  bank_iban TEXT NOT NULL,
  bank_swift TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  proposed_by INTEGER NOT NULL REFERENCES users(id),
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by INTEGER REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  CHECK (decided_by IS NULL OR decided_by <> proposed_by)
);
CREATE UNIQUE INDEX idx_bank_change_one_pending ON bank_account_changes(vehicle_id) WHERE status = 'Pending';

-- Per-investor visibility switch (PRD 6.14, INV-7): rows here hide a
-- vehicle or deal from one investor.
CREATE TABLE vehicle_visibility (
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, investor_id)
);

-- The core record (PRD 8.6): one investor putting money into one vehicle.
-- stage = where it is in its flow; status = whether it's live or exited
-- (PRD 6.13).
CREATE TABLE commitments (
  id SERIAL PRIMARY KEY,
  investor_id INTEGER NOT NULL REFERENCES investors(id),
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  flow TEXT NOT NULL CHECK (flow IN ('HoldCo', 'Fund', 'IB')),
  stage TEXT NOT NULL DEFAULT 'Intent',
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'On hold', 'Dropped', 'Rejected', 'Withdrawn')),
  source TEXT NOT NULL,
  -- Partner with credit for this commitment, copied from the investor when
  -- created inside the credit window.
  partner_id INTEGER REFERENCES venture_partners(id) ON DELETE SET NULL,
  created_via TEXT NOT NULL CHECK (created_via IN ('Admin', 'Partner', 'Investor portal')),
  indicative_amount NUMERIC(14,2) NOT NULL CHECK (indicative_amount > 0),
  committed_amount NUMERIC(14,2) CHECK (committed_amount > 0),
  eligibility JSONB,
  eligibility_checked_at TIMESTAMPTZ,
  min_override_reason TEXT,
  min_override_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expected_close_date DATE,
  soft_confirmed_at TIMESTAMPTZ,
  soft_confirmation_method TEXT CHECK (soft_confirmation_method IN ('Portal', 'Email')),
  shares_issued NUMERIC(18,4) CHECK (shares_issued > 0),
  share_certificate_no TEXT,
  exit_reason TEXT,
  investor_note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One live commitment per investor per vehicle.
CREATE UNIQUE INDEX idx_commitments_one_live ON commitments(investor_id, vehicle_id) WHERE status IN ('Active', 'On hold');
CREATE INDEX idx_commitments_vehicle ON commitments(vehicle_id);
CREATE INDEX idx_commitments_partner ON commitments(partner_id);

CREATE TABLE commitment_events (
  id BIGSERIAL PRIMARY KEY,
  commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_commitment_events_c ON commitment_events(commitment_id, created_at);

-- Internal notes and Q&A on a commitment (PRD 6.8.2 "Q&A tracked").
CREATE TABLE commitment_notes (
  id SERIAL PRIMARY KEY,
  commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payment instructions (PRD 6.6 stage 4). The bank details are copied from
-- the vehicle's approved account at the moment of issue, so a later change
-- can't alter instructions an investor already has.
CREATE TABLE payment_instructions (
  id SERIAL PRIMARY KEY,
  commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  legal_entity TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  bank_account_name TEXT NOT NULL,
  bank_iban TEXT NOT NULL,
  bank_swift TEXT NOT NULL,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ,
  voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT
);
CREATE UNIQUE INDEX idx_one_live_instruction ON payment_instructions(commitment_id) WHERE voided_at IS NULL;

-- Money in and out (PRD 8.8). Every movement needs a proof document and is
-- recorded by an admin; movements are voided, never deleted.
CREATE TABLE money_movements (
  id SERIAL PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('In', 'Out')),
  type TEXT NOT NULL CHECK (type IN ('Subscription payment', 'Fee receipt', 'Partner payout', 'Outbound investment', 'Refund')),
  commitment_id INTEGER REFERENCES commitments(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  value_date DATE NOT NULL,
  counterparty TEXT,
  bank_reference TEXT,
  proof_document_id INTEGER NOT NULL REFERENCES documents(id),
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ,
  voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT
);
CREATE INDEX idx_money_commitment ON money_movements(commitment_id);

-- Evidence each stage needs before a commitment can move into it (PRD 7:
-- "a configurable document checklist per stage"). Editable on the
-- Templates page.
CREATE TABLE stage_requirements (
  id SERIAL PRIMARY KEY,
  flow TEXT NOT NULL CHECK (flow IN ('HoldCo', 'Fund', 'IB', 'IB deal')),
  stage TEXT NOT NULL,
  label TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO stage_requirements (flow, stage, label, doc_type, sort_order) VALUES
  ('HoldCo', 'Offer documents issued', 'Term sheet', 'Term sheet', 10),
  ('HoldCo', 'Offer documents issued', 'Subscription Agreement (SSA)', 'Subscription Agreement (SSA)', 20),
  ('HoldCo', 'Offer documents issued', 'Shareholders'' Agreement (SHA) or deed of adherence', 'Shareholders'' Agreement (SHA)', 30),
  ('HoldCo', 'Signed by investor', 'SSA signed by the investor', 'Subscription Agreement (SSA)', 10),
  ('HoldCo', 'Signed by investor', 'SHA signed by the investor', 'Shareholders'' Agreement (SHA)', 20),
  ('HoldCo', 'Fully executed', 'Fully executed SSA', 'Subscription Agreement (SSA)', 10),
  ('HoldCo', 'Fully executed', 'Fully executed SHA', 'Shareholders'' Agreement (SHA)', 20),
  ('HoldCo', 'Shares issued', 'Board resolution', 'Board resolution', 10),
  ('HoldCo', 'Shares issued', 'Share register extract', 'Register extract', 20),
  ('HoldCo', 'Shares issued', 'Share certificate', 'Share certificate', 30);

-- The two standing vehicles (BIZ-2, BIZ-8, LEG-1, MON-2). The receiving
-- bank accounts are added through the two-admin approval on the Vehicles
-- page.
INSERT INTO vehicles (type, name, legal_entity, status, target_raise, pre_money_valuation, min_ticket_individual, min_ticket_entity, summary) VALUES
  ('HoldCo', 'Retail X HoldCo raise', 'Retail X HoldCo', 'Open', 2000000, 8000000, 25000, 25000,
   'Equity in Retail X HoldCo, RIV''s holding company, and through it in RISE, RIOS, Capital Advisory and RIV''s startup stakes. Raising USD 2M at USD 8M pre-money.'),
  ('Fund', 'Retail X Fund I', 'Retail X Fund', 'Open', 50000000, NULL, 100000, 500000,
   'A USD 50M retail-focused early-stage VC fund with a life of about 6 years. The fund is being set up; RIV is collecting non-binding soft commitments.');
