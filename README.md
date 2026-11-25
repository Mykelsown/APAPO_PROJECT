# Apapo

One app to link accounts across banks. Split-Pay pays one amount from several accounts with automatic rollback. Split-Receive divides an incoming payment across your accounts and keeps a settlement ledger. Safe Send checks the recipient before money moves.

## Layout

| Folder | What lives there | Owner |
| --- | --- | --- |
| backend | Go API, Postgres migrations, simulated banks (mock provider) plus an unused real-provider adapter slot | Backend |
| frontend | React app (added by the frontend owner) | Frontend |
| docs | API contract, build progress | Shared |

## Run the backend

Fastest: `make run` (needs Go 1.24). It starts in mock mode with no database, a fixed sign in code of 123456, and the demo user already set up.

With Docker: `make up` (API on port 8080 plus Postgres; the database is reachable only inside compose, through `docker compose exec db psql -U apapo`). Set `API_PORT` to use another host port.

Without Make: copy `backend/.env.example` to `backend/.env`, set `DATABASE_URL` if you want Postgres, then `go run ./cmd/api` inside `backend`.

Tests: `make test`. Set `TEST_DATABASE_URL` to include the Postgres tests.

## Demo order (about five minutes)

`make demo` walks this with the server running (mock mode, `DEV_OTP=123456`). It uses two users and works the same with or without a database. The mock really moves money, so restart the server or use an empty database before each run.

1. Sign in as user one (`08012345678`, PIN 4821) and user two, Bola (`08098765432`, PIN 5912). Code is 123456, BVN any 11 digits.
2. User one links the four banks and sees one balance.
3. User two links two more banks and sets Split-Receive rules: 30 percent to savings, 40 percent to spending.
4. User one sends N20,000 to user two by phone number. The lookup shows only a masked name. Retrying with the same key does not pay twice.
5. User two's rules split that credit, and `/api/reconciliation` shows sent + held + kept = credit.
6. A simulated salary of N200,000 arrives for user two and splits the same way.
7. Safe Send: a payment to `9000000001` is flagged high, a clean Apapo user is not.
8. Rollback: switch on a failure for the last account (`POST /api/demo/failure`), pay N150,000, watch every earlier leg reverse.
9. Hold and retry: switch on `reversal_down` for the collector's bank, pay again. The payment sits in needs attention with the money safe. Clear the fault and the retry worker finishes the rollback within about 10 seconds.
10. Split-Pay N150,000 to an outside recipient with nothing failing.
11. Shield: `GET /api/shield/check?amount_kobo=7800000` warns about the unconfirmed N80,000 credit.
12. History and recent recipients show only user one's own payments.
13. Privacy: user one cannot read user two's Split-Receive runs.

## Deploying

Set these on the host: `DATABASE_URL`, `APP_SECRET` (long random), `ENCRYPTION_KEY` (`openssl rand -base64 32`), and `PROVIDER=mock`. The hackathon gives no bank API, so Apapo runs on its simulated banks (apex, delta, savanna, harbor). `BANK_API_URL` and `BANK_API_KEY` only matter if a real provider is ever added. Set `ALLOWED_ORIGIN` to the frontend's origin, and `TRUST_PROXY=true` only if a proxy you run sets `X-Forwarded-For`. The first log line starting `config:` shows what the server picked up, without secrets. Leave `DEV_OTP` unset. The server refuses to start with `PROVIDER=real` and a default secret or `DEV_OTP`. Run it behind HTTPS. Migrations run on start. Back up the database and keep the two secrets safe: losing `ENCRYPTION_KEY` means linked banks must be re-linked, and changing `APP_SECRET` invalidates scam report matching and pending codes.

## Docs

- [API contract](docs/api-contract.md): what the frontend and backend agree on. Changes are announced first.
- [Build progress](docs/PROGRESS.md): which phases are done and what comes next.
- [Frontend notes](docs/FRONTEND_NOTES.md): how the screens should use the API, in plain words.
