CREATE TABLE merchant_overrides (
    user_id      TEXT NOT NULL REFERENCES users(id),
    merchant_key TEXT NOT NULL,
    category     TEXT NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, merchant_key)
);
