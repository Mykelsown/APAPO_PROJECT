CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    phone       TEXT NOT NULL UNIQUE,
    bvn_hash    TEXT,
    pin_hash    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE linked_accounts (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    bank_code       TEXT NOT NULL,
    provider_ref    TEXT NOT NULL,
    token_encrypted BYTEA,
    consent_scope   TEXT NOT NULL DEFAULT '',
    consent_at      TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Parent split payments.
CREATE TABLE transfers (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id),
    idempotency_key  TEXT NOT NULL,
    state            TEXT NOT NULL CHECK (state IN ('planned','collecting','sending','completed','rolled_back','needs_attention')),
    amount_kobo      BIGINT NOT NULL CHECK (amount_kobo > 0),
    fee_kobo         BIGINT NOT NULL DEFAULT 0,
    recipient        JSONB NOT NULL,
    message          TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
);

-- Child legs of a split payment, and the destination legs of a Split-Receive run.
CREATE TABLE transfer_legs (
    id            TEXT PRIMARY KEY,
    transfer_id   TEXT NOT NULL REFERENCES transfers(id),
    account_id    TEXT NOT NULL,
    bank_code     TEXT NOT NULL,
    amount_kobo   BIGINT NOT NULL CHECK (amount_kobo > 0),
    fee_kobo      BIGINT NOT NULL DEFAULT 0,
    state         TEXT NOT NULL CHECK (state IN ('pending','collected','failed','reversed')),
    provider_ref  TEXT,
    error         TEXT NOT NULL DEFAULT '',
    position      INT  NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transfer_legs_transfer_idx ON transfer_legs(transfer_id);

-- Scam reports. Recipients are stored only as salted hashes.
CREATE TABLE reports (
    id                 TEXT PRIMARY KEY,
    recipient_hash     TEXT NOT NULL,
    reporter_user_id   TEXT NOT NULL REFERENCES users(id),
    evidence_ref       TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (recipient_hash, reporter_user_id)
);

-- Every state change and security event lands here.
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT,
    event       TEXT NOT NULL,
    subject_id  TEXT,
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_idx ON audit_log(user_id, at DESC);
