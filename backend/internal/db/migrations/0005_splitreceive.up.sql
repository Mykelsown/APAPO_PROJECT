-- One rule set per user: where incoming money goes, and the standing consent to do it.
CREATE TABLE split_receive_rules (
    user_id              TEXT PRIMARY KEY REFERENCES users(id),
    receiving_account_id TEXT NOT NULL,
    destinations         JSONB NOT NULL,
    consent_at           TIMESTAMPTZ NOT NULL,
    revoked_at           TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One run per incoming credit. The unique key is what stops a repeated notification splitting twice.
CREATE TABLE split_receive_runs (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id),
    credit_id    TEXT NOT NULL,
    account_id   TEXT NOT NULL,
    amount_kobo  BIGINT NOT NULL CHECK (amount_kobo > 0),
    received_at  TIMESTAMPTZ NOT NULL,
    state        TEXT NOT NULL CHECK (state IN ('detected','splitting','settled','partially_settled','needs_attention')),
    message      TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, credit_id)
);

CREATE TABLE split_receive_legs (
    id            TEXT PRIMARY KEY,
    run_id        TEXT NOT NULL REFERENCES split_receive_runs(id),
    position      INT NOT NULL,
    destination   JSONB NOT NULL,
    amount_kobo   BIGINT NOT NULL CHECK (amount_kobo > 0),
    fee_kobo      BIGINT NOT NULL DEFAULT 0,
    state         TEXT NOT NULL CHECK (state IN ('pending','collected','failed')),
    provider_ref  TEXT,
    error         TEXT NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX split_receive_legs_run_idx ON split_receive_legs(run_id);
