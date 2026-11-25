# Things only you can do

Collected as the backend is built. Tick them off as you go.

## Before the first run on your machine

- [ ] Install Go 1.24 or newer, and Postgres 16 (or Docker, then `docker compose up --build` does the rest).
- [ ] Copy `backend/.env.example` to `backend/.env` and fill it in:
  - `APP_SECRET`: any long random string (for example `openssl rand -base64 48`).
  - `ENCRYPTION_KEY`: exactly `openssl rand -base64 32`. Keep it safe; losing it makes stored bank tokens unreadable.
  - `DATABASE_URL`: your Postgres connection string. Leave empty to run in memory.
  - `DEV_OTP=123456` for development only. Remove it in any real deployment.
- [ ] In `backend`, run `go mod tidy` once. The build environment could not reach every module host, so this makes sure `go.sum` is complete on your machine. Commit the result.
- [ ] Run the tests: `go test ./...`. Add `TEST_DATABASE_URL` pointing at an empty throwaway Postgres database to include the database tests (they delete data, so never point it at real data).

## Later phases

### B9: real bank provider integration

**Out of scope for this build.** Do not obtain bank credentials or configure
`PROVIDER=real` now. The implementation in `backend/internal/bank/real` stays as
reference code until real API documentation is available. Keep `PROVIDER=mock`
for the hackathon rehearsal.

(Added below as each phase lands.)

## Split-Receive (B11)

- Optional: set `SCAN_INTERVAL_SECONDS` (default 10). With the real bank, replace polling with the bank's credit webhook if it offers one.
- Confirm the real bank marks final credits so `Verified` is set correctly in `internal/bank/real/real.go`. If it does not, no credit will ever be split.
- Run migration 0005 (automatic on start when `DATABASE_URL` is set).

## Safe Send (B6)

- `APP_SECRET` also salts recipient hashes. Changing it later makes old scam reports unmatchable, so set it once and keep it.
- Real name enquiry: the mock resolves names from a demo list. With the real bank, wire the bank's name enquiry into `safesend.Service.ResolveName` in `cmd/api/main.go`. Without it, no recipient can reach the `low` tier unless the user has paid them before.
- Scam reports are only as good as their evidence. Decide how reporters will get a real evidence reference (transaction id or screenshot upload) before launch.

## Security (B8)

- Serve the API over HTTPS only (the host or a proxy must terminate TLS). The HSTS header assumes it.
- Decide the real default and maximum daily limits with the bank's compliance team. Defaults are N1,000,000 and N10,000,000 in `internal/limits/limits.go`.
- PIN hashing is argon2id (H3) and the check-then-pay limit gap is closed (H2).
- Frontend: send `pin` in the execute body and handle 401 `invalid_pin`, 423 `locked`, 422 `daily_limit_exceeded`.

## Hardening stage (H tasks)

- `backend/.env` is not read by the server on its own. Load it into the shell first: `set -a; . backend/.env; set +a`, then `make run` or `go run ./cmd/api`.
- A throwaway test database can run in Docker: `docker run -d --name apapo-pg-dev -e POSTGRES_USER=apapo -e POSTGRES_PASSWORD=apapo -e POSTGRES_DB=apapo -p 127.0.0.1:55432:5432 postgres:16-alpine`, then create `apapo_test` and point `TEST_DATABASE_URL` at it.
- Docker: `make up` no longer exposes the database on the host. The compose secrets are demo values; for anything shared, export `APP_SECRET` and `ENCRYPTION_KEY` in the shell before `docker compose up`.
- Existing PIN hashes upgrade themselves to argon2id on each user's next correct PIN; nothing to run. Each PIN check takes about 19 MiB of memory for a moment, so size the server for peak logins (100 at once is about 2 GB).
- HTTPS (H8): the server speaks plain HTTP and sends an HSTS header, so a proxy or the host must terminate TLS in front of it. Still to decide: where it is deployed and its domain (item E). Once known, set `ALLOWED_ORIGIN` to the frontend's exact origin (scheme, host, port, no trailing path) and, if the platform puts a proxy in front, `TRUST_PROXY=true` so the auth rate limit sees real client IPs. Without `TRUST_PROXY` behind a proxy, every user shares one IP and the limit would hit everyone at once.
- Check the startup log line starting `config:` after each deploy: it should say `dev_otp=off`, `database=on`, `encryption_key=set` and the right origin.
