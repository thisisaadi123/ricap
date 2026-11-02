-- Sessions issued before this moment no longer work. Set when a password is
-- reset, so a stolen session can't outlive the reset.
ALTER TABLE users ADD COLUMN sessions_valid_from TIMESTAMPTZ;
