# Endpoint log

## R2

### GET /api/me

- Status: changed
- Caller: signed in
- Request: no body or query fields
- Response: `user`, `onboarding`, `display_name`, `receiving_account`
- User fields: `id`, `phone`, `display_name`, `bvn_verified`, `pin_set`
- Onboarding fields: `bvn_verified`, `pin_set`, `complete`
- Receiving account: `null` until R3
- Errors: `401 unauthorized` for missing token, `401 invalid_token` for dead or expired sessions
- Frontend behavior: use this as the profile and onboarding-state source. It is not paged or polled.

### PUT /api/me/profile

- Status: new
- Caller: signed in
- Request: `display_name`, string, required, 1-80 Unicode characters after trimming
- Response: `user`
- Errors: `400 invalid_json`, `400 invalid_display_name`, `401 unauthorized`, `401 invalid_token`
- Frontend behavior: trim may happen on the server. Refresh the profile after success if the caller also changes onboarding state.
- Never returned: PIN, BVN, OTP code or tokens

Tell the frontend owner: use `GET /api/me` for profile and onboarding state, and `PUT /api/me/profile` to change a display name. Do not send or expect receiving-account data until R3.

## R3

### PUT /api/me/receiving-account

- Status: new
- Caller: signed in, onboarded
- Request: `account_id`, string, required
- Response: `receiving_account` with account id, bank code, bank name, masked account number and other existing account fields
- Errors: `400 invalid_json`, `403 onboarding_required`, `404 not_found`
- Frontend behavior: list only accounts from `GET /api/accounts`, then send the selected account id. Foreign or inactive accounts are refused.
- Never returned: full account number or provider data

### GET /api/users/lookup

- Status: new
- Caller: signed in
- Request: `phone`, query string, required Nigerian phone format
- Response: `user` with `recipient_type: "apapo"` and `display_name` as a masked name
- Errors: `400 invalid_phone`, `401 unauthorized`, `404 not_found`, `429 rate_limited`
- Privacy: unknown users, users still onboarding, users without display names and users without a receiving account return the same `404 not_found`
- Frontend behavior: show only the masked name. Never send or expect the looked-up account or other profile fields.

Tell the frontend owner: receive account selection belongs to R3; lookup for P2P payments uses this endpoint and returns only a masked name.

## R4

### POST /api/splitpay/preview

- Status: changed
- Caller: signed in, onboarded
- Request: `amount_kobo`, `recipient`; outside recipient sends `bank_code`, `account_number`, optional `account_name`; Apapo recipient sends `apapo_phone`
- Response: existing legs, fees and risk fields plus `recipient` with `recipient_type` and `masked_display_name` for Apapo recipients
- Errors: existing preview errors plus `400 self_send`, `400 invalid_phone`, `404 not_found`
- Privacy: the client never sends or receives the resolved P2P receiving account

### POST /api/splitpay/execute

- Status: changed
- Caller: signed in, onboarded
- Request: existing PIN and Idempotency-Key requirements plus outside or Apapo recipient fields
- Response: existing payment fields; P2P recipient metadata includes type and masked name only
- Errors: existing PIN, limit, insufficient-funds and idempotency errors plus `400 self_send`, `404 not_found`
- Behavior: P2P resolves to the recipient's receiving account server side, performs the same split, rollback and idempotency behavior, and creates a confirmed recipient credit with reference prefix `p2p_`
- Audit: sender and recipient receive separate audit entries

Tell the frontend owner: P2P Split-Pay sends only `recipient.apapo_phone`; display only the masked name and never attempt to read or send the resolved account.

## R7

### GET /api/payments

- Status: new
- Caller: signed in, onboarded
- Request: `limit` optional integer 1-100, default 20; `before` optional payment id
- Response: `payments`, `next_before`
- Payment fields: `id`, `state`, `amount_kobo`, `fee_kobo`, `recipient`, `created_at`, `updated_at`
- Errors: `400 invalid_query`, `401 unauthorized`, `403 onboarding_required`
- Privacy: only payments sent by the signed-in user are returned
- Paging: pass `next_before` back as `before`; unknown or foreign cursors return an empty page

### GET /api/recipients/recent

- Status: new
- Caller: signed-in, onboarded
- Request: `limit` optional integer 1-50, default 20
- Response: `recipients`
- Recipient fields: P2P `recipient_type` and masked display name; outside `recipient_type`, bank code, masked account number and account name
- Errors: `400 invalid_query`, `401 unauthorized`, `403 onboarding_required`
- Privacy: only the signed-in user's sent-recipient history is used
- Tell the frontend owner: recent recipients are deduplicated and masked; never send or request resolved P2P account data.

## R8

### POST /api/risk/check and Split-Pay preview

- Caller: signed in, onboarded
- P2P: clean known recipients may reach low; independent reports against the resolved receiving account still apply.
- P2P: name mismatch, unusual amount and possible duplicate signals prevent low.
- Outside: existing name enquiry, report and known-beneficiary rules apply.

### GET /api/shield/check

- Caller: signed in, onboarded
- Shield ignores confirmed credits and unconfirmed credits whose reference starts with `pay_`, `rev_`, `sr_`, or `p2p_`.
- Other unconfirmed credits within the existing 24-hour and 10-percent window still alert.
- Tell the frontend owner: do not show Shield alerts for Apapo own movements or P2P credits.

## R6

### GET /api/splitpay/{id}

- Status: changed
- Caller: signed in, onboarded
- Request: payment id in the path
- Response: existing payment state and legs plus `reversal_attempt_count`, `next_reversal_retry_at`, `last_reversal_attempt_at`, and `human_review`
- Behavior: `needs_attention` means safely held money is waiting for reversal retries. The worker retries with growing delays using the same reversal reference. When every leg is reversed, state changes to `rolled_back`.
- After many failures, `human_review` becomes true and retrying continues.
- Unknown reversal outcomes remain `needs_attention` until a definitive result is returned.

## R5

### Split-Receive P2P credit handling

- P2P bank credits have reference prefix `p2p_` and are confirmed credits, so the recipient's active rules split them normally.
- One run is created per user and bank credit ID. Repeated scans return no additional run and do not pay shares twice.
- Own Apapo collection and reversal movements use `pay_`, `rev_`, or `sr_` and are ignored by Split-Receive.
- The settlement ledger still requires sent plus held plus kept to equal the P2P credit.
- Tests cover P2P split exactly once, P2P rules for two users, own-movement prefixes, duplicate scans and Postgres persistence.

## R9

### POST /api/demo/failure

- Status: changed (mock mode only; the route does not exist with PROVIDER=real)
- Caller: anyone running the demo, no sign in needed
- Request: `bank_code` or `account_id`, and `mode`
- New mode `reversal_down` needs a `bank_code`. Reversals that touch that bank fail as "bank unavailable", while normal transfers keep working.
- Mode `none` with a `bank_code` also clears the reversal fault for that bank.
- A missing `bank_code` with `reversal_down` returns 400 `invalid_request`.
- Purpose: shows the hold and retry path. A payment rolls back, its reversal fails, the payment shows `needs_attention`, then the worker retries and it ends `rolled_back` once the fault is cleared.
- Tell the frontend owner: this is for the demo only. Do not build a screen that depends on it.
