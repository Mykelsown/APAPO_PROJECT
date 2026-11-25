ALTER TABLE transfers
    DROP COLUMN human_review,
    DROP COLUMN last_reversal_attempt,
    DROP COLUMN next_reversal_retry,
    DROP COLUMN reversal_attempts;
