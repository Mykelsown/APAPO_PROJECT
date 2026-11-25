CREATE TABLE user_limits (
    user_id    TEXT PRIMARY KEY,
    daily_kobo BIGINT NOT NULL CHECK (daily_kobo > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
