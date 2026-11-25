# Apapo API contract

Agreed between backend and frontend. Any change is announced to the other side first. The frontend builds against a mock layer that follows this file, then switches to the real backend with one flag.

## Conventions

- Money is an integer in kobo. Never decimals.
- Times are ISO 8601 strings in UTC.
- Authenticated routes take a short-lived bearer token (15 minutes) and a refresh token.
- Payment execution requires an idempotency key header. The same key returns the original result.
- Errors always return a code, a human message and optional details.
- Every money route (accounts, dashboard, Split-Pay, Split-Receive, Safe Send, Shield, insights, audit, limits, sessions list) needs a signed in user who finished onboarding (BVN and PIN). Otherwise 401 `unauthorized` / `invalid_token`, or 403 `onboarding_required` with `details.next_step`.

## Fixed vocabularies

| Name | Values |
| --- | --- |
| Risk tier | low, unknown, high |
| Leg state | pending, collected, failed, reversed |
| Payment state | planned, collecting, sending, completed, rolled_back, needs_attention |
| Credit verification | confirmed, unverified |
| Split-Receive run state | detected, splitting, settled, partially_settled, needs_attention |

## Endpoints

Status shows what is live today. Planned endpoints may not exist yet.

| Area | Endpoint | Purpose | Status |
| --- | --- | --- | --- |
| System | GET /healthz | Service is up | Live |
| Auth | POST /api/auth/otp, verify-otp, bvn, pin, login, refresh, logout | Phone, OTP, mock BVN, PIN, returning sign in, session refresh, sign out | Live |
| Identity | GET /api/me | Signed-in user's profile, onboarding state, display name and receiving account | Live (R2) |
| Identity | PUT /api/me/profile | Update the signed-in user's display name | Live (R2) |
| Identity | PUT /api/me/receiving-account | Set the signed-in user's default receiving account | Live (R3) |
| Identity | GET /api/users/lookup?phone= | Look up an onboarded Apapo user with a receiving account | Live (R3) |
| Banks | GET /api/banks/supported | Banks with a supported or coming soon flag, plus the consent text | Live |
| Banks | GET /api/banks/linked, POST /api/banks/link, DELETE /api/banks/:id | List links, link with consent, revoke | Live |
| Accounts | GET /api/accounts | Linked accounts, masked numbers, balances | Live |
| Dashboard | GET /api/dashboard | Total balance, bank cards, merged feed | Live |
| Dashboard | PUT /api/categories/override | Pick a category for one merchant | Live |
| Split-Pay | POST /api/splitpay/preview | Plan legs, fees, total, risk result. Recipient is either outside `recipient {bank_code, account_number, account_name?}` or Apapo `recipient {apapo_phone}`. Apapo recipients are resolved server side. | Live (R4; includes recipient type and masked name) |
| Split-Pay | POST /api/splitpay/execute | Run the plan. Idempotency-Key header and the user's `pin` in the body are required. P2P is resolved server side. 400 `self_send`, 404 `not_found`; existing 401/423/422 and idempotency errors also apply. | Live (R4) |
| Split-Pay | GET /api/splitpay/:id | Payment state with every leg state and R6 reversal retry fields: `reversal_attempt_count`, `next_reversal_retry_at`, `last_reversal_attempt_at`, `human_review` | Live |
| Payments | GET /api/payments | Signed-in user's sent payments, newest first, with `limit` and `before` paging | Live (R7) |
| Recipients | GET /api/recipients/recent | Signed-in user's recent distinct Apapo and outside recipients | Live (R7) |
| Split-Receive | GET, PUT, DELETE /api/splitreceive/rules | Rules for dividing incoming money. PUT body: `receiving_account_id`, `destinations` (1 to 5, each either `account_id` of an own account or `beneficiary {bank_code, account_number, account_name}`, plus either `percent` or `fixed_kobo`), `standing_consent: true` and `pin`. `percent` is a number from 0 to 100 with at most two decimals (12.5 is fine, 12.345 is 400 `invalid_rules`). Missing consent is 400 `consent_required`; a wrong PIN is 401 `invalid_pin` | Live (B11) |
| Split-Receive | GET /api/splitreceive/runs, runs/:id | Each split credit with leg states | Live (B11) |
| Split-Receive | POST /api/splitreceive/scan, runs/:id/retry | Check for new credits now; retry failed shares | Live (B11) |
| Ledger | GET /api/reconciliation?from&to | Per credit: sent + held + kept = credit, plus totals | Live (B11) |
| Demo (mock only) | POST /api/demo/simulate-credit | `{amount_kobo, sender_name?, verified? (default true), account_id?}` makes money arrive and scans | Live (B11) |
| Reconciliation | GET /api/reconciliation | Where every naira of each credit went | Planned (B11) |
| Safe Send | POST /api/risk/check | Risk tier (low, unknown, high), reasons and flags. Body same as preview | Live (B6) |
| Safe Send | GET /api/shield/check, POST /api/shield/dismiss | `check?amount_kobo=` returns `{alert}` or null when a pending transfer is within 10 percent of an unverified credit from the last 24 hours; `dismiss {credit_id}` hides it | Live (B6) |
| Safe Send | POST /api/reports | Report a scam account `{recipient:{bank_code,account_number}, evidence_ref}`. Evidence required, 5 per day, one report per reporter per account | Live (B6) |
| Insights | GET /api/insights/shifts | Spending shifts: this month so far against the same days last month, per category. Only changes of 20% or more, N5,000 or more and 3+ transactions. Each has direction, change_pct, current and previous totals, counts, averages, weekend share, top counterparties, supporting transaction ids and a plain summary | Live (B7) |
| Security | GET /api/audit, GET and PUT /api/security/limits | `GET /api/audit?limit&before` newest first with `next_before`. `GET/PUT /api/security/limits`: `{daily_limit_kobo, pin}` (N1,000 to N10,000,000, default N1,000,000), returns limit, spent today and remaining. The limit covers Split-Pay and money Split-Receive sends on; the day starts at midnight Lagos time | Live (B8) |
| Security | GET /api/sessions, POST /api/sessions/logout-all | List where the user is signed in (flags the current one); sign out everywhere | Live (B8) |
| Demo | POST /api/demo/failure | Mock only: force a bank or account to fail so the rollback can be shown. Mode `reversal_down` with a `bank_code` makes reversals at that bank fail so hold and retry can be shown; mode `none` clears it | Live |
| Demo | POST /api/demo/simulate-credit | Mock only: simulate a confirmed credit | Planned (B11) |

## Dashboard in detail

One call returns everything for the home screen: total balance (banks that did not answer are left out), a card per linked bank, and the merged transaction feed, newest first.

**Cards:** link id, bank code and name, balance and masked accounts. A bank that did not answer in 3 seconds comes back with unavailable true and no balance, and the other banks are unaffected.

**Feed rows:** id, account id, bank code and name, direction (credit or debit), amount in kobo, narration, counterparty, category, verification (confirmed or unverified) and posted time. The feed object also carries next_cursor (empty on the last page) and unavailable_banks, banks whose history could not be read.

**Query options:** q (search in narration and counterparty), bank, category, direction, days (1 to 90, default 60), limit (1 to 100, default 20) and cursor (pass next_cursor back to get the next page). A bad value returns 400 invalid_query.

**Categories:** transport, food, airtime_data, bills, shopping, transfer, income, other. Rules pick the default. PUT /api/categories/override with a merchant name and a category makes every transaction from that merchant use that category for this user from then on. Unknown categories return 400 invalid_category with the allowed list.

Verification is confirmed for everything until Safe Send (B6) starts marking credits from unknown senders as unverified.

## Bank linking in detail

**Supported banks** returns the picker list (code, name, supported true or false; coming soon banks have supported false) and the consent block for the consent screen: the scopes a user can agree to (accounts, balances, transactions, each with a plain label), how long consent lasts (90 days), and which scope is required (accounts).

**Link** takes a bank code and a consent object with accepted true and the chosen scopes. It answers 201 with the link (id, bank code, scopes, consent time and expiry) and that bank's accounts with masked numbers. In mock mode a new user gets a seeded account at each bank they link, with a balance and 60 days of history.

**Revoke** ends the link and deletes the stored bank token. After that the bank's accounts disappear from accounts, dashboard and Split-Pay. Linking the same bank again later is allowed. Consent also ends by itself after 90 days.

**Accounts** returns every account at active links, plus an unavailable list of banks that did not answer in time, so the screen can show a down state for that bank instead of failing.

Split-Pay now plans only from accounts at active links. A bank that is down is skipped; if the rest cannot cover the amount the user gets insufficient_funds.

| Situation | Status | Code |
| --- | --- | --- |
| Consent not accepted | 400 | consent_required |
| Scopes missing accounts or unknown | 400 | invalid_consent |
| Bank is coming soon or unknown | 422 | bank_not_supported |
| Bank already linked | 409 | already_linked |
| Bank did not respond | 502 | bank_unavailable |
| Unknown link on revoke | 404 | not_found |

## Auth and onboarding in detail

**Sign up flow:** request a code with the phone, verify the code (this signs the person in and returns tokens), submit the BVN, then set a PIN. Returning users sign in with phone and PIN through login. Phone numbers can be written as 0801..., 234801... or +234801...; all become +234 form.

**Token rules:** every protected call sends the access token as a bearer token. Access tokens last 15 minutes and refresh tokens 30 days. Refresh returns a brand new pair and the old pair stops working, so always store the new refresh token. On a 401 with invalid_token the frontend refreshes once, and if that fails sends the user to sign in.

**Responses:** verify-otp and login return the user (id, phone, bvn_verified, pin_set) plus both tokens and their expiry times. BVN and PIN return the updated user. Money features (preview, execute, status and everything after) need a signed in user with bvn_verified and pin_set both true; otherwise they answer 403 onboarding_required with details.next_step set to bvn or pin, so the frontend can route to the right screen.

**Rules the frontend should mirror:** BVN is 11 digits; PIN is 4 to 6 digits; a code is 6 digits, lasts 5 minutes, allows 5 wrong tries, and at most 3 codes can be requested per phone every 10 minutes. Five wrong PINs lock the account for 15 minutes.

| Situation | Status | Code |
| --- | --- | --- |
| Bad phone number | 400 | invalid_phone |
| Too many codes requested | 429 | rate_limited |
| Wrong code | 400 | invalid_otp |
| Code expired | 400 | otp_expired |
| Too many wrong codes | 429 | too_many_attempts |
| Bad BVN or PIN format | 400 | invalid_bvn, invalid_pin |
| PIN before BVN | 409 | bvn_required |
| PIN already set | 409 | pin_already_set |
| Wrong phone or PIN | 401 | invalid_credentials |
| Locked out | 423 | locked (details.locked_until) |
| Missing or dead token | 401 | unauthorized, invalid_token |
| Not onboarded | 403 | onboarding_required |

**Dev code:** with DEV_OTP set (the default in .env.example is 123456) every code is that number, so the frontend can sign in without SMS. The demo phone +2348012345678 is tied to the seeded demo banks.

## Split-Pay preview in detail

Request fields: amount in kobo, recipient (bank code, 10 digit account number, optional account name), and optional strategy (largest_first or lowest_fee), minimum balance to keep per account in kobo, and a leg limit (default 4, maximum 8). Unknown fields are rejected.

Response fields: the legs (account id, bank code, bank name, masked account number, amount, fee), the amount, total fee, total debit (amount plus fees, what leaves the user's accounts), the risk result, and a flags list.

Preview error codes: invalid_json, invalid_amount, invalid_recipient, invalid_rules, invalid_strategy (all 400); insufficient_funds (422, details carry spendable and shortfall in kobo); too_many_legs (422); bank_unavailable (502).

## Split-Pay execute and status in detail

**Execute** takes the same body as preview plus a required Idempotency-Key header (8 to 100 characters). The backend plans again itself and never trusts legs sent by the client. It answers 202 with the payment straight away and finishes the work in the background, so the frontend polls the status endpoint every 1 to 2 seconds until the state is completed, rolled_back or needs_attention.

Repeating a key with the same payment returns 200 and the original payment, even after it has finished and balances have moved. Reusing a key for a different amount or recipient returns 409 idempotency_conflict. A missing key returns 400 missing_idempotency_key.

**Status** returns the payment id, state, amount, total fee, masked recipient, a message, the legs and timestamps. Each leg has account id, bank code, amount, fee and state; a leg carries an error word (insufficient_funds, bank_unavailable, timeout or bank_error) only when something went wrong. Unknown payments, and payments belonging to someone else, return 404.

How a payment runs: the first leg is the collector account. Every other leg pays into it, then the collector sends the full amount to the recipient. If any step fails with a definite error, completed legs are reversed in reverse order and the payment ends rolled_back with the message "We reversed the earlier steps. Your money is back." If a reversal fails, or a bank times out three times so the outcome is unknown, the payment ends needs_attention with a message the screen can show as is.

Leg fees are recorded and shown, but the mock banks do not charge them, so the totals the user sees are the plan, not a bank statement.

**Demo failure switch** (mock mode only, the route does not exist otherwise): send either an account id or a bank code, plus a mode of timeout, insufficient_funds, bank_down or none to clear it. Forcing the third account in a plan (for example acc_savanna_1) to bank_down gives the classic leg three failure.


## Response content (conceptual)

- **Preview:** legs (account, bank, amount, fee), total fee, total amount, risk result (tier plus reasons), flags such as duplicate or shield warning.
- **Payment status:** payment state, each leg with its state, a plain message when rolled back.
- **Dashboard:** total balance, bank cards with an unavailable flag, feed rows (bank, amount, direction, category, verification status).
- **Shift:** category, previous and current totals, percent change, counts, average amounts, weekend share, top counterparties, supporting transaction IDs.
- **Split-Receive run:** the credit, each destination leg with state and fee, run state, and a reconciliation total that equals the credit.

## Ownership of the AI feature

The backend owns the numbers (the shifts endpoint). The frontend owner owns the words and the card. The model key lives only in a small server side function, never in the browser.

## Mock data the frontend can rely on

The demo user has four fake banks (Apex Bank, Delta Trust Bank, Savanna Bank, Harbor MFB) with balances of N70,000, N60,000, N45,000 and N20,000. A N150,000 payment needs three legs. Transport spending is about 40 percent higher this month than last, and food is down.

### Risk and flags (B6)

Tiers: `high` needs 3 or more independent reporters; `low` needs a known or name-verified recipient with no reports and no warning flags; everything else is `unknown`. Flags: `reported_recipient`, `name_mismatch`, `new_beneficiary`, `unusual_amount` (5x or more the median of recent payments), `possible_duplicate` (same amount and recipient within 10 minutes). Dashboard rows for credits the bank has not confirmed carry `verification: "unverified"`.

### Hardening (H8)

- **CORS:** only the origin in the server's `ALLOWED_ORIGIN` may call the API from a browser. Preflight answers 204 and allows `Authorization`, `Content-Type` and `Idempotency-Key` with GET, POST, PUT and DELETE. Any other origin gets 403 `origin_not_allowed` on preflight. Tokens travel in the `Authorization` header, never cookies, so do not set `credentials: "include"`.
- **Auth rate limit:** every `/api/auth/*` route allows a burst of 20 requests per client IP, refilled at 30 a minute. Over that: 429 `rate_limited` with a `Retry-After` header and `details.retry_after_seconds`. This is separate from the per-phone code limit, which also answers 429 `rate_limited`.
- **Timeouts:** each request has 30 seconds. Execute still answers 202 straight away; the payment itself keeps running after that.

### Security (B8)

PIN is required to execute a payment, change Split-Receive rules and change limits. Five wrong PINs lock money actions for 15 minutes (423). Every response carries nosniff, frame deny, no-referrer, no-store, HSTS and a deny-all content security policy. Request bodies reject unknown fields and are size capped. Audit detail never includes tokens, PINs, OTPs or BVNs.
