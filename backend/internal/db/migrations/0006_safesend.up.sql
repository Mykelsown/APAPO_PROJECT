-- Seeded demo reports come from made up reporters, so the user foreign key goes.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reporter_user_id_fkey;
CREATE INDEX IF NOT EXISTS reports_recipient_idx ON reports(recipient_hash);
CREATE INDEX IF NOT EXISTS reports_reporter_day_idx ON reports(reporter_user_id, created_at);

CREATE TABLE shield_dismissals (
    user_id    TEXT NOT NULL,
    credit_id  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, credit_id)
);
