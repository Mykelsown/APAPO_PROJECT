DROP INDEX IF EXISTS linked_accounts_user_idx;
ALTER TABLE linked_accounts DROP COLUMN IF EXISTS consent_expires_at;
