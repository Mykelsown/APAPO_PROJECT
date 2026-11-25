ALTER TABLE linked_accounts ADD COLUMN consent_expires_at TIMESTAMPTZ;
CREATE INDEX linked_accounts_user_idx ON linked_accounts(user_id);
