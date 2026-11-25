ALTER TABLE users
    ADD COLUMN pin_failed       INT NOT NULL DEFAULT 0,
    ADD COLUMN pin_locked_until TIMESTAMPTZ;

-- One live code per phone. Only a hash of the code is stored.
CREATE TABLE otp_codes (
    phone         TEXT PRIMARY KEY,
    code_hash     TEXT NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    attempts      INT NOT NULL DEFAULT 0,
    sent_count    INT NOT NULL DEFAULT 1,
    window_start  TIMESTAMPTZ NOT NULL
);

-- Tokens are random and opaque; only their hashes are stored.
CREATE TABLE sessions (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id),
    access_hash      TEXT NOT NULL UNIQUE,
    access_expires   TIMESTAMPTZ NOT NULL,
    refresh_hash     TEXT NOT NULL UNIQUE,
    refresh_expires  TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at       TIMESTAMPTZ
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
