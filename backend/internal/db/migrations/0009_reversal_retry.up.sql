ALTER TABLE transfers
    ADD COLUMN reversal_attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN next_reversal_retry TIMESTAMPTZ,
    ADD COLUMN last_reversal_attempt TIMESTAMPTZ,
    ADD COLUMN human_review BOOLEAN NOT NULL DEFAULT FALSE;
