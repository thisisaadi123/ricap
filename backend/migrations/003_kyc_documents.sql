-- M2 KYC & documents (PRD 6.4, 8.3, 8.7, 6.14). Checklists are rows, not
-- code, so Novo Juris's final lists can be loaded without a release (LEG-6).

CREATE TABLE kyc_checklist_templates (
  id SERIAL PRIMARY KEY,
  kyc_type TEXT NOT NULL CHECK (kyc_type IN ('Individual', 'Entity')),
  label TEXT NOT NULL,
  description TEXT,
  required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One file per KYC round. A refresh opens a new file; the old one stays as
-- history with is_current = false.
CREATE TABLE kyc_files (
  id SERIAL PRIMARY KEY,
  investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  kyc_type TEXT NOT NULL CHECK (kyc_type IN ('Individual', 'Entity')),
  status TEXT NOT NULL DEFAULT 'Open'
    CHECK (status IN ('Open', 'Submitted', 'Information requested', 'Cleared', 'Rejected')),
  is_current BOOLEAN NOT NULL DEFAULT true,
  pep_status TEXT CHECK (pep_status IN ('Not a PEP', 'PEP', 'Related to a PEP')),
  sanctions_result TEXT CHECK (sanctions_result IN ('No match', 'Potential match', 'Confirmed match')),
  sanctions_checked_at DATE,
  sanctions_method TEXT,
  source_of_funds TEXT,
  tax_self_cert BOOLEAN NOT NULL DEFAULT false,
  risk_rating TEXT CHECK (risk_rating IN ('Low', 'Medium', 'High')),
  classification TEXT CHECK (classification IN ('Retail client', 'Professional client', 'Market counterparty')),
  decision_note TEXT,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  refresh_due DATE,
  submitted_at TIMESTAMPTZ,
  opened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_kyc_one_current ON kyc_files(investor_id) WHERE is_current;

-- Documents (PRD 8.7). linked_type/linked_id point at the record a document
-- belongs to. Files live in storage (local folder in dev, Supabase Storage
-- later); storage_key is the path there.
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  linked_type TEXT NOT NULL CHECK (linked_type IN ('investor', 'partner', 'kyc_item', 'kyc_ubo', 'template')),
  linked_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  -- Earlier version this one replaces (e.g. the signed copy of a draft).
  replaces_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  confidentiality TEXT NOT NULL DEFAULT 'Internal'
    CHECK (confidentiality IN ('Restricted', 'Internal', 'Shareable with investor', 'Shareable with partner')),
  signature_status TEXT NOT NULL DEFAULT 'Not required'
    CHECK (signature_status IN ('Not required', 'Sent', 'Signed by counterparty', 'Fully executed', 'Signed offline')),
  zoho_envelope_id TEXT,
  template_id INTEGER,
  source TEXT NOT NULL DEFAULT 'Admin upload'
    CHECK (source IN ('Investor upload', 'Admin upload', 'Received by email', 'Received in person')),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ,
  voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT
);
CREATE INDEX idx_documents_linked ON documents(linked_type, linked_id);

CREATE TABLE kyc_items (
  id SERIAL PRIMARY KEY,
  kyc_file_id INTEGER NOT NULL REFERENCES kyc_files(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES kyc_checklist_templates(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  description TEXT,
  required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'Received', 'Verified', 'Rejected')),
  review_note TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX idx_kyc_items_file ON kyc_items(kyc_file_id);

CREATE TABLE kyc_ubos (
  id SERIAL PRIMARY KEY,
  kyc_file_id INTEGER NOT NULL REFERENCES kyc_files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ownership_pct NUMERIC(5,2) CHECK (ownership_pct BETWEEN 0 AND 100),
  nationality TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Counsel-approved templates (LEG-4). The file itself is a document with
-- linked_type = 'template'.
CREATE TABLE document_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  version_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Active', 'Retired')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE documents ADD CONSTRAINT documents_template_fk
  FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE SET NULL;

-- Starting checklists from PRD 6.4. A starting point only: Novo Juris
-- supplies the final lists, which admins load on the Templates page.
INSERT INTO kyc_checklist_templates (kyc_type, label, description, required, sort_order) VALUES
  ('Individual', 'Passport', 'Clear copy of the photo page.', true, 10),
  ('Individual', 'Emirates ID or national ID', 'Both sides.', true, 20),
  ('Individual', 'Proof of residential address', 'Utility bill or bank statement from the last 3 months.', true, 30),
  ('Individual', 'Source of funds and source of wealth declaration', NULL, true, 40),
  ('Individual', 'PEP self-declaration', 'Whether you are, or are related to, a politically exposed person.', true, 50),
  ('Individual', 'Tax residency self-certification (FATCA / CRS)', NULL, true, 60),
  ('Individual', 'Investor classification declaration', 'Only if RIV asks for it.', false, 70),
  ('Entity', 'Certificate of incorporation / trade licence', NULL, true, 10),
  ('Entity', 'Memorandum & articles of association', NULL, true, 20),
  ('Entity', 'Register of shareholders and UBO declaration', 'With ID for each ultimate beneficial owner.', true, 30),
  ('Entity', 'Board resolution authorising the investment', NULL, true, 40),
  ('Entity', 'Authorised signatory list with IDs', NULL, true, 50),
  ('Entity', 'Source of funds', NULL, true, 60),
  ('Entity', 'Tax self-certification (FATCA / CRS)', NULL, true, 70);
