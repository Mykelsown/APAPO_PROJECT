# Backend build progress

Updated at the end of every phase. To resume, read the "Next up" line, then open the phase in `apapo-backend-build-plan`.

| Phase | What | Status |
| --- | --- | --- |
| B0 | Foundation: Go service, migrations, BankProvider, mock banks, contract | Done |
| B1 | Split-Pay planner | Done |
| B2 | Payment executor with rollback | Done |
| B3 | Auth and onboarding (mock BVN) | Done |
| B4 | Account linking, consent, revoke | Done |
| B5 | Dashboard aggregation | Done |
| B6 | Safe Send risk engine | Done |
| B7 | Spending shift insights | Done |
| B8 | Security layer and audit | Done |
| B9 | Real bank provider adapter | Done (provider API shape still needs real documentation) |
| B10 | Seed and demo readiness | Done |
| B11 | Split-Receive and settlement ledger | Done |

## Log

### B0 (2026-10-29)

- Go module in `backend`, standard library router, `lib/pq` for Postgres. No other dependencies.
- `bank.Provider` interface and typed errors. `mock.Provider` with four fake banks, idempotent transfers by reference, reversals, and forced failures per bank or per account.
- Demo seed: balances force a three way split for N150,000; 60 days of history with a 40 percent transport shift.
- Migration 0001 creates users, linked_accounts, transfers, transfer_legs, reports, audit_log. Tested against Postgres 16.
- Contract file at `docs/api-contract.md`.

Notes:
- Go modules from gopkg.in are blocked in the build environment, so chi, pgx and testify are not used. If you want them on your own machine, swapping is a small change.
- Docker was not available in the build environment, so `docker compose up` is written but untested.

### B1 (2026-10-29)

- `internal/planner`: pure function that splits an amount across accounts. Strategies largest_first and lowest_fee, minimum balance (global and per account), leg limit with fallback to fewer legs, typed errors with shortfall detail.
- `internal/api`: HTTP layer now lives here. `POST /api/splitpay/preview` is live with masked account numbers and a placeholder risk result.
- Routing moved out of `cmd/api` into the api package. Fees come from a small mock fee table until the real provider reports them.
- Verified: table-driven planner tests (exact fit, insufficient funds, single account, minimum balance, fee preference, leg limit) and a live call returning a three way split for N150,000.

### B2 (2026-10-29)

- `internal/payments`: explicit state machines for payments and legs with a transitions table that refuses illegal moves. Memory store for tests and no database mode, Postgres store for real.
- Executor: collector account design, retry only on timeouts (retries reuse the reference, so they cannot double charge), reverse in reverse order, `needs_attention` when a reversal fails or an outcome cannot be confirmed.
- Every state change is written to `audit_log` with a timestamp.
- API: `POST /api/splitpay/execute` (202, background run, Idempotency-Key required), `GET /api/splitpay/:id`, and mock only `POST /api/demo/failure`.
- Bug found by a test and fixed: retrying a finished payment re-planned against new balances and failed. The key is now checked before planning.
- Verified: the leg three failure test reverses legs one and two and ends rolled_back with balances restored; reversal failure, timeout, duplicate key and conflicting key tests; same scenario against real Postgres; live server run with audit rows written.

### B3 (2026-10-29)

- `internal/auth`: phone OTP (hashed, 5 minute expiry, 5 tries, 3 sends per 10 minutes), mock BVN behind an `IdentityVerifier` interface (stored only as a keyed hash), PIN (4 to 6 digits, PBKDF2 hash, lockout after 5 wrong tries for 15 minutes), opaque access and refresh tokens (only hashes stored, refresh rotates).
- API: auth endpoints plus middleware. Money routes now need a signed in user who finished onboarding. The demo user stand in from B1 and B2 is gone; the demo phone maps to the seeded banks.
- Migration 0002 adds PIN lockout columns, `otp_codes` and `sessions`.
- Added `POST /api/auth/login` and `POST /api/auth/logout`, which were not in the first contract, so returning users can sign in and the lockout rule has a place to run.
- PIN hashing uses the standard library's PBKDF2 because argon2 and bcrypt need modules this environment cannot download. `CheckPIN` is ready for B8 to demand a PIN on every payment.
- Verified: full flow, wrong code, attempt limit, expiry, send rate limit, PIN lockout and unlock, refresh rotation, logout, onboarding gates; all of it against real Postgres too.

### B4 (2026-10-29, branch mykels-backend)

- `internal/links`: link, list, revoke, 90 day consent that expires on its own. Provider tokens are encrypted with AES-256-GCM and wiped on revoke. Every link and revoke is written to the audit log.
- `bank.Linker` interface (link, accounts at one bank, unlink) so the mock and the real provider are interchangeable. Mock gives each new user seeded accounts at the banks they link.
- `internal/audit`: one audit logger (memory and Postgres) with a paged list, ready for the audit endpoint in B8.
- `internal/secrets`: the encryption helper.
- API: supported banks with consent text, link, linked list, revoke, accounts with an unavailable list. Split-Pay now plans only from active links.
- Migration 0003 adds consent expiry.
- Verified: link two banks, revoke one and its accounts vanish from Split-Pay, token never stored in the clear, double link, coming soon bank, bank down, consent expiry; Postgres versions of the same.

### B5 (2026-10-29, branch mykels-backend)

- `GET /api/dashboard`: total balance, one card per bank, merged feed. Banks are read at the same time with a 3 second limit each, so one slow bank only shows as unavailable.
- Feed supports search, bank, category and direction filters, a day window, and cursor paging that visits every row exactly once.
- `internal/categorize`: keyword rules plus per merchant overrides (`PUT /api/categories/override`), stored per user. Migration 0004.
- A `Verifier` hook returns confirmed for everything until B6 plugs in.
- Bug caught while writing it: shortened timestamps broke string sorting, so feed times now use a fixed width format.
- Verified: totals and cards, ordering, paging across 7 row pages, filters and bad parameters, a down bank, overrides; plus the Postgres override store.

### B9 (2026-10-29, branch mykels-backend)

- `internal/bank/real`: an HTTP provider that implements the same `Provider` and `Linker` interfaces as the mock, chosen with `PROVIDER=real` plus `BANK_API_URL` and `BANK_API_KEY`.
- Reads retry temporary failures with a doubling pause. Transfers are sent exactly once per call and carry the reference as an Idempotency-Key header; the payment executor repeats a timed out transfer with the same reference, so a retry can never double charge. A transfer without a reference is refused.
- Bank errors map to our typed errors (insufficient funds, account not found, bank unavailable, timeout).
- Demo routes exist only in mock mode. `main` picks the provider from config.
- Honest limit: real bank API documentation was not available, so the provider's paths and JSON shapes are an assumed layout, proven against a local fake server only. See `docs/MANUAL_STEPS.md` for the current out-of-scope status.

### B11 (2026-10-29, branch mykels-backend)

- `internal/splitreceive`: rules per user (percent in basis points or a fixed amount, up to 5 destinations, own account or outside beneficiary). The rest stays in the receiving account. Needs explicit standing consent and the PIN; only credits after consent are ever split.
- Only bank verified credits are split. Unverified ones are ignored. Apapo's own movements (pay_, rev_, sr_ references) are never re-split. One run per credit, enforced by a unique key.
- Legs are independent, no rollback: failed shares can be retried (`/runs/{id}/retry`). Run states: detected, splitting, settled, partially_settled, needs_attention.
- Ledger: sent + held + kept always equals the credit, exposed at `/api/reconciliation`.
- Background scan every `SCAN_INTERVAL_SECONDS` (default 10, 0 turns off). Daily limit hook is ready for B8.
- Migration 0005. Mock only `simulate-credit` demo endpoint.
- Verified: normal split, fixed plus percent, duplicate scan, unverified, pre-consent credits, failed leg then retry, timeout, daily limit stub, revoked consent, rule validation; API end to end.

### B6 (2026-10-29, branch mykels-backend)

- `internal/safesend`: risk checker, scam reports stored only as salted keyed hashes, Shield for unconfirmed credits.
- Preview now returns real risk and flags. `/api/risk/check`, `/api/reports`, `/api/shield/check`, `/api/shield/dismiss`.
- Dashboard shows `unverified` for credits the bank has not confirmed.
- Mock seeded with 5 flagged, 5 clean, 5 unknown recipients (`mock.DemoRecipients`) and an unverified N80,000 credit from yesterday (`mock.SeedUnverifiedCredit`, applied in `main` only).
- Migration 0006 (drops the reporter foreign key so seeded reporters work, adds dismissals). `payments.Store` gained `Recent`.
- Verified: reporter thresholds and duplicates, evidence and daily limit, each signal, Shield window and dismissal, API flow, Postgres version.

### B8 (2026-10-29, branch mykels-backend)

- PIN now required on `POST /api/splitpay/execute` (with lockout). Same PIN check on Split-Receive rules and limit changes.
- `internal/limits`: daily limit per user (Lagos day), counted across Split-Pay and Split-Receive sends, enforced in preview, execute and each Split-Receive leg. Migration 0007.
- `GET /api/audit` (paged), `GET /api/sessions`, `POST /api/sessions/logout-all`. Payment events now go to the same audit log as everything else.
- Security headers on every response.
- Known limit: the limit check and the payment start are not one atomic step, so two payments fired at the same instant could both pass. Fine for the demo, worth a database-level reservation before real money.
- Verified: missing, wrong and locked PIN; limit set, hit and reported; audit includes limit change; sessions list and logout-all kills the token; headers. Full suite also green against Postgres.

### B10 (2026-10-29, branch mykels-backend)

- `scripts/demo.sh` walks the whole demo (sign in, link, Safe Send, rollback, Split-Pay, Shield, Split-Receive and ledger) and was run against both the in-memory server and a Postgres-backed one. `Makefile` has run, test, demo and up.
- README has the demo order and deploy notes. Compose now sets the dev secrets it needs.
- Bug found while doing this: `config.Load` was not reading `BANK_API_URL`, `BANK_API_KEY` or the scan interval, so `PROVIDER=real` would have started with an empty bank URL. Fixed with a test. The server now also refuses to start with `PROVIDER=real` plus the default secret or `DEV_OTP`.
- The seeded unverified N80,000 credit no longer counts in the available balance, which keeps the three way Split-Pay demo intact.

### B7 (2026-10-29, branch mykels-backend)

- `internal/insights`: compares this month so far with the same days of last month (Lagos time), per spending category. A shift needs 20% or more, N5,000 or more and 3 or more transactions. Each shift carries the numbers behind it (counts, averages, weekend share, top counterparties, supporting transaction ids) and a plain sentence. No AI is needed for the numbers; the AI card can rephrase the summary.
- `GET /api/insights/shifts`. On the seeded demo user it reports transport up 40% (N30,000 to N42,000, mostly Bolt) and food down 50%.

**All planned backend phases (B0 to B12) are built.** See `docs/MANUAL_STEPS.md` for what only you can do.

## Hardening stage (H tasks from `docs/HANDOFF.md`)

### H0 (2026-11-04, branch mykels-backend)

- Machine: Ubuntu 24.04, Docker 29, system Go 1.22.2. `go.mod` asks for Go 1.24.7, so Go's toolchain switch runs a newer toolchain automatically (tests here ran on Go 1.26.8).
- `go mod tidy` changed nothing: `go.sum` was already complete for `lib/pq`.
- Test database: a throwaway `postgres:16-alpine` container on `127.0.0.1:55432` (databases `apapo_test` for tests, `apapo_run` for local runs). The system Postgres on 5432 is left alone.
- `make test` green with `TEST_DATABASE_URL` set, no skipped tests. `make demo` passes all 7 steps on memory and on an empty Postgres database (migrations 0001 to 0007 applied cleanly).
- Note: nothing reads `backend/.env` by itself. Load it with `set -a; . backend/.env; set +a` before `go run`.

### H1 (2026-11-04, branch mykels-backend)

- `docker compose up --build` built fine on the first try, then failed to start: "failed to bind host port 0.0.0.0:5432/tcp: address already in use". Cause: compose published the database on host port 5432, which a Postgres installed on the host already holds. The API talks to the database over the compose network, so the host port was never needed; it is gone. Use `docker compose exec db psql -U apapo` to look inside.
- Second problem found while reading the build: `COPY . .` copied `backend/.env`, with real secrets, into the build stage because there was no `.dockerignore`. Added `backend/.dockerignore`; checked that the build stage now holds only source files.
- Also: the API container has a health check on `/healthz`, runs as an unprivileged user, and `APP_SECRET`, `ENCRYPTION_KEY`, `DEV_OTP` and the host port (`API_PORT`) can be overridden from the shell. Defaults stay the demo values.
- Verified: `docker compose up --build --wait` reaches healthy for both services, `scripts/demo.sh http://localhost:8080` passes all 7 steps against the container, 7 migrations applied in the container database.

### H2 (2026-11-04, branch mykels-backend)

- Why: the limit check (`limits.Allow`) and the payment start (`Executor.Start`) were two separate steps, so two payments fired at the same instant could both read the same spent-so-far and both pass.
- `limits.Service.Reserve(ctx, user, amount, record)`: takes a per-user lock, checks the limit, runs `record` (which writes the spend), then releases. The next caller for that user always sees the spend.
- Locks: `limits.MemoryLocker` (per-user, gives up when the request context ends, forgets idle users) for no database; `limits.PGLocker` with Postgres, which takes the in-process lock and then `pg_advisory_xact_lock` keyed by the user, so several API instances also take turns. The in-process lock comes first so waiters never hold pooled connections that the lock holder needs.
- Split-Pay execute: the quick pre-check stays (an over limit payment never touches a bank), then `Reserve` wraps `Executor.Start`. If a twin request with the same Idempotency-Key won the race, the loser gets the original payment, not a 422.
- Split-Receive: `splitreceive.Limiter` is now `Reserve`. A leg's transfer and its "sent" record happen inside the lock, because a Split-Receive share only counts once it is marked sent. The lock is per user, so other users never wait.
- Tests: 20 concurrent reservations under a N10,000 limit at N3,000 each pass exactly 3 times (memory, and Postgres with two lockers standing in for two instances); 12 concurrent HTTP executes give exactly three 202 and nine 422. With the lock switched off the same tests let 20, 7 and 6 through, so they really test the lock. Full suite green with `-race` and Postgres.

### H3 (2026-11-04, branch mykels-backend)

- New dependency: `golang.org/x/crypto` v0.48.0 (brings `golang.org/x/sys` v0.41.0). Pinned on purpose: the newest release (v0.58.0) requires Go 1.26 and would have raised `go.mod` from 1.24.7 and broken the `golang:1.24-alpine` Docker build. v0.48.0 is the newest that still supports Go 1.24.
- New PINs are hashed with argon2id at the OWASP baseline (19 MiB, 2 passes, 1 thread), stored as `argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`. The cost lives in `auth.PINArgon2`; tests lower it.
- Old `pbkdf2$...` hashes still verify. On a correct PIN (login or any PIN check) the stored hash is silently rewritten as argon2id; the same happens if `PINArgon2` is raised later. A wrong PIN, or a correct PIN while locked out, never changes the hash. Corrupt rows and absurd cost values are refused instead of being run.
- Tests: new hash format and verify, wrong PIN for both formats, old hash verifies and is upgraded (PIN check and login), raised cost rehashes, lockout unchanged with an old hash, corrupt hashes. Live check: the demo user's PBKDF2 hash in a Postgres database from H0 became argon2id on the demo's first PIN use.

### H8 (2026-11-04, branch mykels-backend; deploy target still open)

- CORS: `ALLOWED_ORIGIN` (one exact origin). Default is no cross-origin access. Preflight is answered before routing (the router has no OPTIONS routes, so it used to answer 405), allows `Authorization`, `Content-Type`, `Idempotency-Key`; other origins get 403 `origin_not_allowed`.
- Timeouts: every request gets a 30 second context deadline, which bank calls and queries honour; the HTTP server now also has read (15s), write (45s) and idle (2m) timeouts, so slow clients cannot hold connections open forever.
- Per-IP token bucket on `/api/auth/*`: burst 20, 30 a minute, 429 `rate_limited` with `Retry-After`. `TRUST_PROXY=true` takes the client IP from the last `X-Forwarded-For` entry (the one the proxy wrote); without it the header is ignored, so it cannot be forged to dodge the limit. Idle buckets are swept.
- Leak test: signs in, pays, fails a PIN, changes limits and rules, then checks every response (except the ones that hand out tokens), every audit entry and every log line for the PIN, BVN, sign in code and tokens. One exception by design: the development `LogSender` prints codes, which H6 replaces. Checked the test really catches a leak by adding a log line that printed the PIN: it failed as it should.
- Startup line: `config: provider=... database=on|off dev_otp=on|off allowed_origin=... trust_proxy=... encryption_key=set|derived (dev) scan_interval=...`. No secret values.
- Verified live: preflight 204 for the allowed origin and 403 for another, the 21st rapid login from one IP got 429, and the secret does not appear in the log. Full suite green with `-race` and Postgres.
- Not done: documenting the deploy target and domain (needs item E).

### H9 (2026-11-04, branch mykels-backend)

- Checked `docs/api-contract.md` against the code for every item in the handoff list. Already there: preview risk and flags, dashboard `verification`, Shield endpoints, insights, audit, limits and sessions. Added: a convention line that every money route needs an onboarded user (401 or 403 `onboarding_required` with `next_step`); execute errors with their detail fields (`locked_until`; `limit_kobo`, `spent_kobo`, `remaining_kobo`; `insufficient_funds` with `spendable_kobo`, `shortfall_kobo`; a missing PIN is `invalid_pin`); the Split-Receive rule body, `standing_consent: true`, the PIN and the two decimal percent rule.
- `docs/FRONTEND_NOTES.md`: a conceptual guide for the frontend owner (no code): origin and tokens, onboarding routing, the preview, PIN, Idempotency-Key and polling flow with an error table, unverified credits, Shield, Split-Receive rules, insights, security screens, and what the backend never returns.

### R0 (2026-11-22)

- Read the requested project documents and audited the repository on `mykels-backend`. The worktree was clean before R0. Git identity is configured.
- Verified the Go module's existing B0 to B11 implementation with `make test`, `go test -race -p 1 ./...`, `go vet ./...`, and `gofmt -l .`. All passed, including database tests against the isolated Postgres 16.16 container on `127.0.0.1:55432`.
- `make demo` passed in memory mode and with Postgres. The Postgres run applied migrations 0001 to 0007.
- Tool check passed: Go 1.26.8, Git 2.53.0, GNU Make 4.4.1, Docker 29.1.3, psql 18.6, curl 8.18.0, jq 1.8.1, OpenSSL 3.5.5, and gofmt. No installation was needed.
- The overview table above was stale: B6, B7, B8, B10 and B11 were labeled not started or next despite their implementation, tests, and later completion entries. Updated the overview to match the repository. B9's provider is implemented, but its assumed API shape is not verified against real bank documentation.
- R0 found no baseline test, formatting, vet, race, or demo failure. The development OTP sender writes one-time codes to its log; this conflicts with the instruction not to log codes and remains a known issue to address before broader use.
- Legacy programme references are being removed from project-facing documentation and neutralized in comments and configuration. `backend/internal/bank/real` and executable demo fixtures are retained pending explicit approval of code cleanup.
- No dependencies or environment variables were added.

### R1 (2026-11-24)

- Replaced the original programme framing in `README.md` and `docs/HANDOFF.md`.
- Marked B9, H4, H5, H6, H7 and H10 out of scope in the handoff and manual steps.
- Neutralized real-provider comments and replaced the generic bank API test fixture URL.
- Recommended retaining `backend/internal/bank/real` for the mock-only rehearsal and replacing it only after real API documentation is available. The existing executable catalog entry and test fixtures that name a former bank should not be deleted or renamed without approval.
- No real provider code or provider behavior was changed.
- No dependencies or environment variables were added.
- One R1 `make test` run failed at connection setup because the throwaway Postgres container had exited. The container was restarted on `127.0.0.1:55432`, and the complete Postgres-backed suite passed immediately afterward. The failure was infrastructure only; no code fix was required.

### R2 (2026-11-24)

- Added `display_name` and `receiving_account_id` columns to the auth user model and migration 0008. Memory and Postgres stores now persist display names.
- Added signed-in identity endpoints `GET /api/me` and `PUT /api/me/profile`. Both require authentication but not BVN/PIN completion.
- Added display name validation: trimmed, 1-80 Unicode characters. The PIN setup body accepts optional `display_name` for onboarding.
- `GET /api/me` returns profile and onboarding state; `receiving_account` remains `null` until R3.
- Added memory and Postgres tests for profile persistence, profile validation, and two different users with login, refresh, and logout.
- No dependencies or environment variables were added.

### R3 (2026-11-24)

- Added default receiving-account persistence to the existing 0008 profile migration and auth stores.
- Added `PUT /api/me/receiving-account`, requiring signed-in, onboarded ownership of an active linked account.
- Updated `GET /api/me` to return the selected receiving account object or `null`.
- Added `GET /api/users/lookup?phone=` with Nigerian phone normalization and privacy-preserving 404 responses.
- Lookup returns only `recipient_type: "apapo"` and a masked display name. Unknown users, incomplete users and users without receiving accounts share the same not-found answer.
- Added lookup rate limiting with `429 rate_limited` and `Retry-After`.
- Added tests for ownership, no receiving account, privacy, unknown phones, masked names and lookup throttling.
- No dependencies or environment variables were added.

### R4 (2026-11-24)

- Extended Split-Pay preview and execute to accept `recipient.apapo_phone` and resolve it to the recipient's receiving account server side.
- Added self-send, unknown-recipient and no-receiving-account validation.
- Added the second mock demo identity and `DEMO_PHONE_2`, plus mock P2P account transfer support.
- P2P transfers use confirmed credits with reference prefix `p2p_` and the recipient's own receiving account.
- Added P2P masked recipient metadata and low-tier Safe Send behavior for clean, known Apapo recipients.
- Added sender and recipient audit entries and P2P idempotent retry coverage.
- No dependencies were added. New environment variable: `DEMO_PHONE_2`.

### R5 (2026-11-24)

- Verified P2P credits with `p2p_` references are eligible for Split-Receive and create one run per credit.
- Verified duplicate scans do not split the same P2P credit twice in memory or Postgres.
- Verified `pay_`, `rev_`, and `sr_` references remain ignored as Apapo collection, reversal and Split-Receive movements.
- Added two-user P2P Split-Receive tests, ledger balance assertions and Postgres exactly-once coverage.
- Added mock test helpers for exact-reference confirmed P2P and own-movement credits.
- No dependencies or environment variables were added.

### R6 (2026-11-24)

- Added persisted reversal retry fields and `needs_attention` to `rolled_back` state transition.
- Added a background retry worker with growing delays, startup rescan and periodic unfinished-payment rescan.
- Every reversal attempt uses the existing provider reference and is written to the audit log.
- Unknown outcomes remain `needs_attention`; repeated failures continue retrying and set `human_review`.
- Status responses expose attempt count, next/last retry time and human-review state.
- Added memory and Postgres tests for fail/succeed, repeated failures, unknown outcomes, restart recovery and no double reversal.
- No dependencies or environment variables were added.

### R7 (2026-11-24)

- Added owner-scoped paged payment history at `GET /api/payments`.
- Added owner-scoped recent recipient history at `GET /api/recipients/recent`.
- Added memory and Postgres stable paging with payment-id cursors.
- P2P recipients remain masked; outside recipients remain bank/account masked.
- Added ownership tests proving another user cannot see sent payments or recent recipients.
- No dependencies or environment variables were added.

### R8 (2026-11-24)

- Confirmed clean Apapo recipients can reach low risk when no report or warning signal blocks it.
- Confirmed P2P reporting remains based on the recipient's resolved receiving account, so independent reports force high.
- Preserved name mismatch, unusual amount and duplicate-payment signals as low-tier blockers.
- Added explicit Shield guards for `pay_`, `rev_`, `sr_`, and `p2p_` references.
- Added memory tests for P2P Safe Send and own-movement Shield behavior.
- No dependencies or environment variables were added.
- One R8 Postgres run initially failed at connection setup because the throwaway Postgres container had exited. It was restarted on `127.0.0.1:55432`; `make test` and the race suite passed afterward. No code fix was required.

### R9 (2026-11-24)

- Rewrote `scripts/demo.sh` as a 13 step two-user demo: sign in, link banks, send to another Apapo user, Split-Receive ledger, Safe Send, rollback, hold and retry, outside Split-Pay, Shield, history, privacy.
- Added a mock-only `reversal_down` mode to `POST /api/demo/failure` so the hold and retry path can be shown over HTTP. Tests cover the mock and the full retry through the API.
- Updated the README demo order for two users.
- The demo ran to the end on the in-memory server and on a fresh Postgres database.
- First draft of the script sent N100,000 to user two and then ran short of money for the N150,000 steps (insufficient_funds at the Safe Send preview). The mock moves real balances, so the send is now N20,000. This was a script problem, not a backend bug.
- No dependencies or environment variables were added.

### R10 (2026-11-24)

Final verification, all green:
- `gofmt -l` prints nothing and `go vet ./...` is clean.
- Full suite with `TEST_DATABASE_URL` set (Postgres 16) passes, and so does `go test -race ./...`.
- `scripts/demo.sh` ran to "Demo complete." on the in-memory server and on a fresh Postgres database.
- No new dependencies. No new environment variables in R9 or R10 (`DEMO_PHONE_2` was added earlier, in R2).

Open items and risks:
- `backend/api.exe` is a built binary that is tracked in git. It should be removed from the repo and ignored. Left alone until you say so.
- The `real` provider in `cmd/api/main.go` and its test still use "Access Bank" as the only bank. It is inert in mock mode and not used for the hackathon, so it is left as is; on build day the real list comes from the hackathon bank API.
- The demo moves real balances in the mock, so it needs a fresh server or database for each full run.
- Docker was not available here, so Postgres was tested on a local cluster, and the Go modules were built through a local module file because the Go proxy was blocked. The repo's `go.mod` is unchanged. Run `make test` once on your machine to confirm.
- Reversal retry runs on a 10 second tick inside one API process. With several instances, two could try the same reversal. The shared provider reference stops a double reversal, but this has not been load tested.
- The five early commits (c1aba57, af8b25a, 3947996, 9b29a6f, 1cf8d9b) still carry Claude trailers. Not rewritten, waiting for your answer.
- Nothing has been pushed.

All phases R0 to R10 are complete.

### Cleanup (2026-11-24)

- Removed the tracked `backend/api.exe` and ignored `*.exe`.
- The hackathon provides no bank API, so Apapo runs on the simulated banks only. The unused real-provider adapter no longer names Access Bank; it uses a placeholder "Example Bank".
- README now says the deployment uses `PROVIDER=mock`.

### Fix: preview rejected a chosen recipient (2026-11-24)

- Symptom: choosing the flagged payee in the Split-Pay screen showed "The request body is not valid" instead of the high risk warning.
- Cause: the frontend keeps `recipient_type` (and, for Apapo users, `masked_display_name`) on the recipient it sends back. The backend decodes bodies strictly and refuses unknown fields, so the whole request failed with `invalid_json` before Safe Send ran.
- Fix: the recipient now accepts and ignores those two display fields. The server still works out the type and masked name itself. Other unknown fields are still refused.
- Test added for both the accepted display fields and a refused unknown field.

