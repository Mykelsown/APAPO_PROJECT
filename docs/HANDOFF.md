# Apapo backend: handoff to Claude Code

Paste the whole file into Claude Code at the root of the cloned repo, or save it as `docs/HANDOFF.md` and tell Claude Code to read it first.

## 0. Kickoff prompt (the short version)

You are taking over the backend of Apapo, a unified banking app built for
the Ogun Innovate Hackathon Fintech track. The backend is built and tested
on a mock bank. Read this whole file, then `docs/PROGRESS.md`,
`docs/MANUAL_STEPS.md`, `docs/api-contract.md`, and `README.md`. Mock mode
and local Postgres are the deployment scope for this build.

## 1. General rules (follow all of them)

1. Commit your work on the local device whenever a phase (a numbered task in section 6) is completed. One commit per phase, never one giant commit at the end.
2. Commit messages carry no attribution to Claude or any assistant: no `Co-Authored-By` trailer, no session link, no mention of the assistant in the message. Plain imperative messages such as `H3: argon2id PIN hashing with upgrade on login`.
3. Never push to `master`. Push only to the branch `mykels-backend` (the apostrophe name Mykel's backend is this branch). Master holds B0 to B3 only and stays as is.
4. Never use em dashes anywhere: code comments, docs, commit messages, README. Use commas, semicolons, colons or middle dots.
5. Never commit secrets. `.env` is git-ignored; keep it that way. Never print secrets in logs or in your replies.
6. Mock first, real later. Everything must keep working with `PROVIDER=mock` and no database. Real integrations plug in behind the existing interfaces.
7. After each phase run `gofmt -l .` (must print nothing), `go vet ./...` and `make test`. Also run with `TEST_DATABASE_URL` set (see 4.4). Update `docs/PROGRESS.md`, `docs/MANUAL_STEPS.md` and, if an endpoint changed, `docs/api-contract.md`.
8. When something fails, explain the error and its cause in your report, not just the fix. I want the "why".
9. Do not add a dependency unless the task says so. Every new module must be
listed in the final report.

## 2. What exists

Repo: `https://github.com/Mykelsown/APAPO` (moved from `Mykelsown/apapo`). Branch with all the work: `mykels-backend`, tip `1cf8d9b`. Master is at `22c02aa` (B0 to B3). Go module path is still `github.com/Mykelsown/apapo/backend`, Go 1.24 or newer, backend lives in `backend/`.

The local `origin` URL may still point at the old address and print a "repository moved" notice. Fix it once: `git remote set-url origin https://github.com/Mykelsown/APAPO.git`.

Layout of `backend/internal`:

| Package | Purpose |
| --- | --- |
| `bank` | Provider and Linker interfaces, shared types and typed errors |
| `bank/mock` | Seeded fake banks, failure injection, demo recipients, `SimulateCredit` |
| `bank/real` | HTTP provider reference implementation with an assumed API shape |
| `planner` | Chooses which accounts pay a Split-Pay amount |
| `payments` | Executor: collect, send, roll back, retry timeouts, stores |
| `auth` | OTP, BVN verifier interface, PIN (PBKDF2), sessions, lockout |
| `links` | Bank linking, 90 day consent, encrypted provider tokens |
| `secrets` | AES-256-GCM box |
| `audit` | One audit log, memory and Postgres |
| `categorize` | Transaction categories and merchant overrides |
| `splitreceive` | Rules, credit scanning, legs, settlement ledger |
| `safesend` | Risk tiers, scam reports (salted hashes), Shield |
| `limits` | Daily limit across Split-Pay and Split-Receive sends |
| `insights` | Month to date spending shifts |
| `api` | HTTP handlers and middleware |
| `db` | Embedded migrations 0001 to 0007 |
| `config` | Environment settings |

Key facts you must not break:

- All money is `int64` kobo. The transfer reference doubles as the idempotency key.
- Payment states: planned, collecting, sending, completed, rolled_back, needs_attention. A failed reversal or an unknown outcome ends in `needs_attention`, never silently.
- Only credits where `Verified == true` trigger Split-Receive. Credits whose reference starts with `pay_`, `rev_` or `sr_` are Apapo's own movements and are ignored.
- Ledger invariant: sent + held + kept == credit.
- Hashes of recipients in scam reports use `APP_SECRET` as the salt.
- Every store has a memory version and a Postgres version; keep both in step.

## 3. Environment variables

| Variable | Meaning | Notes |
| --- | --- | --- |
| `ADDR` | Listen address | default `:8080` |
| `PROVIDER` | `mock` or `real` | default `mock` |
| `APP_SECRET` | Keys hashes of codes, BVNs, recipients | Long random string. Set once and keep. Changing it breaks scam-report matching and pending codes |
| `ENCRYPTION_KEY` | Base64 32 byte key for provider tokens | `openssl rand -base64 32`. Losing it makes stored bank tokens unreadable |
| `DATABASE_URL` | Postgres connection string | Empty means run in memory |
| `DEV_OTP` | Fixed one-time code | Development only, for example `123456`. Unset in production |
| `DEMO_PHONE` | Phone that maps to the seeded demo banks | default `+2348012345678` |
| `BANK_API_URL`, `BANK_API_KEY` | Real bank API address and key | Needed only for a later approved `PROVIDER=real` integration |
| `SCAN_INTERVAL_SECONDS` | How often credits are scanned for Split-Receive | default 10, 0 turns the timer off |
| `TEST_DATABASE_URL` | Throwaway Postgres for tests | Tests DELETE data. Never point it at real data |

The server refuses to start with `PROVIDER=real` while `APP_SECRET` is the default or `DEV_OTP` is set. That is intentional.

Demo identity (mock mode): phone `08012345678`, one-time code `123456` (needs `DEV_OTP=123456`), any 11 digit BVN, PIN `4821`.

## 4. Local setup (do this first, task H0)

1. Check tools: `go version` (1.24 or newer), `psql --version` (Postgres 16) or `docker --version`, `make --version`, `openssl version`. Install what is missing for my OS. Ask me which OS if you cannot tell.
2. `cp backend/.env.example backend/.env`, then fill in `APP_SECRET` (`openssl rand -base64 48`), `ENCRYPTION_KEY` (`openssl rand -base64 32`), `DATABASE_URL`, and `DEV_OTP=123456` for development. Do the generating yourself; do not ask me for these values.
3. Run `go mod tidy` inside `backend` and commit `go.mod` and `go.sum`. The environment that built this code could not reach every module host, so `go.sum` may be incomplete.
4. Create a throwaway Postgres database for tests, for example `apapo_test`. Export `TEST_DATABASE_URL`. Run `make test` (it runs `go vet` and `go test -count=1 -p 1 ./...`; `-p 1` matters because the Postgres tests share one database). Everything must pass, including the Postgres tests.
5. Run `make run`, then in a second terminal `make demo`. Expect 7 steps: sign in, link four banks, Safe Send flags `9000000001` as high, rollback shows `rolled_back` with legs `reversed, reversed, failed`, a clean Split-Pay completes, Shield warns about an unconfirmed N80,000 credit, Split-Receive settles and the ledger balances.
6. Repeat step 5 with `DATABASE_URL` set to a real local database to prove migrations 0001 to 0007 apply cleanly on an empty database.

## 5. Known caveats (so nothing surprises you)

- `docker-compose.yml` and `backend/Dockerfile` have never been run, because Docker was unavailable where this was built. Treat them as untested.
- PIN hashing is PBKDF2-SHA512 from the standard library (210,000 iterations), not argon2id or bcrypt, because those modules could not be downloaded.
- The daily limit check and the start of a payment are two separate steps, so two payments fired at the same instant could both pass the limit.
- The real bank provider reference (`backend/internal/bank/real/real.go`) uses an assumed REST layout. It is proven only against a local fake server and is out of scope until real API documentation is available.
- Name enquiry is mock only. Without a real one, no brand new recipient can reach the `low` risk tier.
- OTP delivery uses `auth.LogSender` (prints the code to the log) and BVN uses `auth.MockVerifier` (accepts any 11 digits). Both are fine for the demo and unacceptable for real users.
- Five commits on `mykels-backend` carry `Co-Authored-By` and `Claude-Session` trailers that break my no-attribution rule: `c1aba57` (B11), `af8b25a` (B6), `3947996` (B8), `9b29a6f` (B10), `1cf8d9b` (B7). See task H12.

## 6. Tasks (work in this order, one commit per task)

### H0. Local setup and green baseline
Do section 4 completely. Done when `make test` is green with Postgres, `make demo` completes on both memory and Postgres, and `go.mod`/`go.sum` are committed. Commit: `H0: tidy modules, verify baseline`.

### H1. Verify Docker
Run `docker compose up --build`, wait for health, run `scripts/demo.sh http://localhost:8080`. Fix whatever breaks in `Dockerfile` or `docker-compose.yml` (for example Go version, build path, the dev `APP_SECRET` and `DEV_OTP` values compose sets). Done when the demo passes against the container. If Docker is not installed and I do not want it, skip and say so.

### H2. Atomic daily limit reservation
Why: today `limits.Allow` reads spent-so-far and `payments.Executor.Start` creates the payment afterwards, so concurrent requests can both pass. Fix: make check plus create one atomic step per user. In Postgres, take `pg_advisory_xact_lock(hashtext(user_id))` inside the same transaction that creates the payment (or add a `daily_usage` reservation row with a conditional update); in the memory store, a per-user mutex. Keep Split-Receive legs on the same mechanism. Add a test that fires N concurrent executes whose sum exceeds the limit and asserts exactly the right number succeed. Run it with `-race`. Done when the test is deterministic and `go test -race ./...` is clean.

### H3. argon2id PIN hashing
Why: PBKDF2 is acceptable, argon2id is the better default for a short PIN. Add `golang.org/x/crypto` (declare it in the report). Store a versioned hash such as `argon2id$v=19$m=...,t=...,p=...$salt$hash`. Keep verifying old `pbkdf2$...` hashes and, on a successful login or PIN check, silently upgrade the stored hash to argon2id. Keep test iterations low via a variable like the existing `PBKDF2Iterations`. Add tests for: new hash verifies, old hash still verifies, old hash gets upgraded, wrong PIN fails, lockout unchanged. Update `docs/MANUAL_STEPS.md`.

### H4. Real bank provider adapter
**Out of scope for this build.** Keep `PROVIDER=mock`.

Blocked on me for access (section 7, item B). Once real bank documentation and credentials are approved:
1. Read `backend/internal/bank/real/real.go`. Change only the paths, the `wire...` structs and `mapError`. Do not change the `bank.Provider` or `bank.Linker` interfaces unless the real API makes it impossible; if so, stop and explain.
2. Make sure the provider sets `Transaction.Verified` correctly from whatever the real API says about a final credit. If the API has no such field, tell me; Split-Receive will never fire without it.
3. Fees: replace the hard-coded mock fee table (`defaultFeeKobo` in `internal/api/splitpay.go`, and the `Fee` function in `cmd/api/main.go`) with real fees if the API exposes them.
4. Decide polling versus webhook for credits. Polling already works through `SCAN_INTERVAL_SECONDS`. If the bank offers a credit webhook, add `POST /api/webhooks/credit` with signature verification, idempotent by credit id, that triggers `Scan` for that user.
5. Run the integration test: `BANK_API_URL=... BANK_API_KEY=... BANK_TEST_USER=<test user id> go test -tags integration ./internal/bank/real`.
6. If the bank API cannot initiate transfers, keep transfers on the mock for the demo and document the limitation plainly.

### H5. Real name enquiry for Safe Send
**Out of scope for this build.**

Why: without it nobody new can be `low` risk. Add a method to the provider side (an optional interface such as `bank.NameResolver` with `ResolveName(ctx, bankCode, accountNumber) (string, bool)`; the mock already has `ResolveName`). Wire the real one in `cmd/api/main.go` where `ssSvc.ResolveName` is set for the mock. Add tests with the fake server. Needs the real API from H4; if the bank API has no name enquiry, document it.

### H6. SMS provider for one-time codes
**Out of scope for this build.**

Implement `auth.OTPSender` (interface in `internal/auth/service.go`, current implementation `LogSender`) for an SMS gateway. Ask me which gateway (Termii, Africa's Talking, Twilio, or another) and for the API key (section 7, item C). Read the key from the environment, never from code. Keep `LogSender` for development. Keep rate limits as they are (3 sends per 10 minutes, 5 tries, 5 minute expiry). Do not log codes when `DEV_OTP` is unset.

### H7. Real BVN verification
**Out of scope for this build.**

Implement `auth.IdentityVerifier` against a real BVN service. Ask me for the provider and credentials (item D). BVNs are stored only as a keyed hash; keep it that way and never log a BVN. Keep `MockVerifier` for development. Note the legal side: BVN lookups need the provider's consent flow; list anything the provider requires in `docs/MANUAL_STEPS.md`.

### H8. Production hardening checklist
- Confirm HTTPS termination in front of the server (the HSTS header assumes it) and document the deploy target I choose (item E).
- Add CORS handling for the frontend origin through an env var such as `ALLOWED_ORIGIN`. There is none yet; the frontend on another origin will be blocked. Default to no cross-origin access, allow exactly the configured origin, handle `OPTIONS` preflight, allow headers `Authorization`, `Content-Type`, `Idempotency-Key`.
- Add a request timeout and a basic per-IP rate limit on `/api/auth/*`.
- Make sure no response or log leaks tokens, PINs, OTPs or BVNs. Add a test that greps the audit output for them.
- Add a startup log line that states provider, whether a database is used, and whether `DEV_OTP` is on, without printing secrets.

### H9. Frontend contract sync
The frontend owner needs these changes spelled out. Verify `docs/api-contract.md` already says each one, and add what is missing:
- Money routes need a signed in, onboarded user.
- `POST /api/splitpay/execute` needs the `Idempotency-Key` header and `pin` in the JSON body. Errors: 401 `invalid_pin`, 423 `locked` (with `locked_until`), 422 `daily_limit_exceeded` (with limit, spent, remaining), 422 `insufficient_funds`.
- Preview returns `risk` (`tier`, `reasons`) and `flags`.
- Dashboard feed items carry `verification` of `confirmed` or `unverified`.
- Shield: `GET /api/shield/check?amount_kobo=` and `POST /api/shield/dismiss`.
- Split-Receive rules need `standing_consent: true` and the PIN; percent is a number with at most two decimals.
- `GET /api/insights/shifts`, `GET /api/audit`, `GET/PUT /api/security/limits`, `GET /api/sessions`, `POST /api/sessions/logout-all`.
Write a short conceptual guide (no raw code) so the frontend teammate can implement against it. Save it as `docs/FRONTEND_NOTES.md`.

### H10. Optional: AI-ready logging (shadow mode)
**Out of scope for this build.**

Only if I confirm (item F). Add a `risk_checks` table (migration 0008) that records, for each preview, the features used (tier, flags, amount bucket, new beneficiary, hour of day) and later the outcome (paid, cancelled, reported as scam within 30 days). No raw account numbers; use the same salted hash as scam reports. Add a `safesend.Scorer` hook that returns "no opinion" for now. The rule: a model may only raise a warning, never lower the tier, and rules stay the floor (a recipient reported by 3 people is always `high`). This prepares for training on real data after launch; do not train anything now. Needs a consent and data-protection review first (NDPR), listed in `docs/MANUAL_STEPS.md`.

### H11. Final verification and handover
Run the full suite with Postgres and `-race`. Run `make demo` on memory and Postgres. Update `docs/PROGRESS.md` with one entry per task. Print a table of every new dependency and every environment variable added. Report anything you could not finish and why.

### H12. Commit attribution cleanup (only with my explicit yes)
Five commits on `mykels-backend` (`c1aba57`, `af8b25a`, `3947996`, `9b29a6f`, `1cf8d9b`) contain `Co-Authored-By: Claude ...` and `Claude-Session: ...` lines. Do not touch history until I answer yes in this task. If I say yes: make a backup branch first (`git branch backup-before-cleanup`), remove only those trailer lines from those five messages (for example `git rebase -i` or `git filter-branch --msg-filter` limited to those commits, or `git filter-repo` if installed), verify the trees are identical (`git diff backup-before-cleanup mykels-backend` must be empty), then `git push --force-with-lease origin mykels-backend`. Never force-push master. Warn me that anyone who already pulled the branch must reset it.

## 7. Items that need me (ask, wait, then continue)

| Item | What you need from me | Needed for |
| --- | --- | --- |
| A | Which OS I am on, and whether I want Docker or a local Postgres | H0, H1 |
| B | Real bank API documentation, base URL, API key, and a test user id, if integration is later approved | H4, H5 |
| C | Which SMS gateway, plus its API key and sender id | H6 |
| D | Which BVN verification provider, plus credentials | H7 |
| E | Where the backend will be deployed and its domain, and the frontend origin | H8 |
| F | Whether I want the AI shadow-mode logging now or after launch | H10 |
| G | Yes or no on rewriting the five commits | H12 |

Things only I can do, not you: approve real bank integration; decide real default and maximum daily limits; decide how real scam-report evidence references are collected; and give consent and data-protection sign-off before using real data to train anything.

## 8. Definition of done

- `make test` green with `TEST_DATABASE_URL` set, plus `go test -race ./...`.
- `make demo` passes on memory, on Postgres, and on Docker if H1 was done.
- `gofmt -l .` prints nothing and `go vet ./...` is clean.
- Every task has its own local commit with a plain message and no assistant attribution.
- Everything is pushed to `mykels-backend` only; `git ls-remote origin` shows `master` still at `22c02aa`.
- `docs/PROGRESS.md`, `docs/MANUAL_STEPS.md` and `docs/api-contract.md` match the code.
- A final report lists: what was done, what was skipped and why, new dependencies, new environment variables, and any risk I should know about before real money.
