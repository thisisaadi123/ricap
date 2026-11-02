-- M6: investor updates, in-app and email alerts (PRD 6.10, 6.14, 8.10, 8.13; INV-3, TECH-4).

ALTER TABLE documents DROP CONSTRAINT documents_linked_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_linked_type_check
  CHECK (linked_type IN ('investor', 'partner', 'kyc_item', 'kyc_ubo', 'template', 'commitment', 'vehicle', 'payout', 'outbound', 'update'));

CREATE TABLE investor_updates (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('Monthly letter', 'Quarterly account statement', 'Deal update', 'Notice', 'Event')),
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'All' CHECK (audience IN ('All', 'Selected')),
  selected_investor_ids INTEGER[] NOT NULL DEFAULT '{}',
  shareable_with_partners BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Published', 'Withdrawn')),
  withdraw_reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  withdrawn_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_updates_vehicle ON investor_updates(vehicle_id);

-- Who received each update; also the log on the investor's record.
CREATE TABLE update_deliveries (
  update_id INTEGER NOT NULL REFERENCES investor_updates(id) ON DELETE CASCADE,
  investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_read_at TIMESTAMPTZ,
  first_read_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (update_id, investor_id)
);
CREATE INDEX idx_update_deliveries_investor ON update_deliveries(investor_id);

-- In-app alert per user, plus the email outbox: routes insert rows inside
-- their transaction, and emails go out once it has committed (lib/notify.js).
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link_view TEXT,
  link_id INTEGER,
  read_at TIMESTAMPTZ,
  email_status TEXT NOT NULL DEFAULT 'None' CHECK (email_status IN ('None', 'Pending', 'Sending', 'Sent', 'Skipped', 'Failed')),
  email_subject TEXT,
  email_body TEXT,
  email_attempts INTEGER NOT NULL DEFAULT 0,
  email_claimed_at TIMESTAMPTZ,
  emailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_outbox ON notifications(id) WHERE email_status IN ('Pending', 'Sending');
