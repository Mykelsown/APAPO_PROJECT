# Frontend notes: what changed and how to build against it

A short guide for the frontend owner. It explains the behaviour the screens must handle; the exact fields live in `docs/api-contract.md`. Money is always an integer in kobo; divide by 100 only for display.

## 1. Talking to the API

- **One origin only.** The backend lets exactly one browser origin call it (the `ALLOWED_ORIGIN` setting on the server). Tell the backend owner the dev origin (for example the local dev server's address) and the production origin. Any other origin is refused.
- **Tokens go in the Authorization header** as a bearer token. No cookies are used, so do not turn on "include credentials" in fetch.
- **Access tokens last 15 minutes.** On a 401 with `invalid_token`, call refresh once and retry the request. Refresh returns a new pair and the old pair stops working, so always store the new refresh token. If refresh fails, send the user to sign in.
- **Too many sign in attempts** from one device or network answer 429 `rate_limited` with a `Retry-After` header (seconds). Show a short wait message and disable the button for that long. The same code is used when one phone requests too many sign in codes.
- **Errors** always have a `code` (switch on this), a `message` (safe to show as is) and sometimes `details`.

## 2. Who may use money screens

Accounts, dashboard, Split-Pay, Split-Receive, Safe Send, Shield, insights, audit, limits and the sessions list all need a signed in user who has finished onboarding (BVN and PIN). If not, the answer is 403 `onboarding_required` and `details.next_step` says where to send them: `bvn` or `pin`. Route on that value rather than guessing.

## 3. Paying with Split-Pay

1. **Preview first.** Send the amount and recipient. The answer shows the legs (which accounts pay how much, masked account numbers), the total fee and total debit, plus a **risk** block (`tier` of low, unknown or high, and plain `reasons`) and a list of **flags**.
   - Show `high` as a strong warning that needs a deliberate extra tap. `unknown` deserves a gentle "check the name" note. `low` needs nothing.
   - Flags to explain in plain words: `reported_recipient`, `name_mismatch`, `new_beneficiary`, `unusual_amount`, `possible_duplicate`.
2. **Ask for the PIN on the confirm screen**, then execute with the same body plus `pin`, and a fresh **Idempotency-Key** header (8 to 100 characters; a random id per payment attempt).
   - Keep the same key if you retry after a network error. The backend then returns the original payment instead of paying twice.
   - Generate a new key only when the user starts a new payment.
3. **Execute answers 202 at once.** Poll the payment status every 1 to 2 seconds until the state is `completed`, `rolled_back` or `needs_attention`. Show each leg's state as it moves. `rolled_back` and `needs_attention` come with a message that can be shown word for word.
   - For `needs_attention`, also show `reversal_attempt_count`, `next_reversal_retry_at` and `human_review`. The backend keeps retrying the reversal with growing delays until every leg is reversed. `human_review: true` means manual review is needed, but retrying continues.

Execute errors to handle:

| Code | Status | What the screen does |
| --- | --- | --- |
| `invalid_pin` | 401 | "Wrong PIN", let them try again. A missing PIN gives the same answer. |
| `locked` | 423 | Five wrong PINs lock money actions. `details.locked_until` says until when; show a countdown and block retries. |
| `daily_limit_exceeded` | 422 | `details` carries `limit_kobo`, `spent_kobo` and `remaining_kobo`. Offer to pay the remaining amount or to raise the limit in security settings. |
| `insufficient_funds` | 422 | `details` carries `spendable_kobo` and `shortfall_kobo`. Suggest a smaller amount or linking another bank. |
| `idempotency_conflict` | 409 | The key was used for a different payment. Make a new key. |
| `missing_idempotency_key` | 400 | A bug in the app: always send the header. |

The preview can also answer `daily_limit_exceeded`, so the limit can be shown before the PIN screen.

## 4. Dashboard

Each feed row has `verification`: `confirmed` or `unverified`. Show unverified credits with a clear "not yet confirmed by the bank" badge. Balances come from the bank as they are; do not add or subtract unverified credits yourself. This pairs with Shield below.

## 5. Shield

Before sending money on, the app checks Shield with the amount it is about to send. If the amount is close to a recent credit the bank has not confirmed, the answer holds an alert with a message (show it as a warning card: "this money may not be real yet"). If there is nothing to warn about the alert is empty. When the user taps "I understand", dismiss that credit's alert so it does not keep coming back.

## 6. Split-Receive rules

- The rules screen picks a receiving account and up to five destinations. Each destination is either one of the user's own accounts or an outside beneficiary (bank, account number, name), and takes either a **percent** or a **fixed amount** in kobo. Whatever is left stays in the receiving account.
- **Percent** is a plain number from 0 to 100 with at most two decimals (12.5 is fine; 12.345 is refused with `invalid_rules`). Limit the input field to two decimals.
- Saving needs **`standing_consent: true`** (an explicit, unticked-by-default checkbox explaining that future confirmed credits will be split automatically) **and the PIN**. Without consent: 400 `consent_required`. Wrong PIN: 401 `invalid_pin`; locked: 423 `locked`.
- Only credits that arrive after consent, and that the bank confirmed, are ever split. The runs list shows each split with leg states; failed shares can be retried. The ledger screen shows sent + held + kept = credit for each credit.
- A P2P credit from another Apapo user has reference prefix `p2p_`. It is split exactly once under the recipient's rules.
- Apapo collection and reversal movements use `pay_`, `rev_`, or `sr_` references and are never shown as incoming credits to Split-Receive. They do not create extra split runs.

## 7. Insights

The shifts endpoint gives this month so far against the same days last month, per category, only where the change is big enough to matter. Each shift carries the numbers (totals, change percent, counts, averages, weekend share, top places, supporting transactions) and a plain one line summary. The backend owns the numbers; the frontend owns the wording and the card. If an AI rephrases the summary, its key stays in a small server side function, never in the browser.

## 8. Security screens

- **Audit:** a newest first list of what happened on the account (links, payments, limit changes, sign outs). Page with `next_before`.
- **Limits:** shows the daily limit, spent today and remaining. Changing it needs the new value and the PIN. Allowed range is N1,000 to N10,000,000; the day resets at midnight Lagos time. Split-Pay and money that Split-Receive sends on both count.
- **Sessions:** a list of where the user is signed in, with the current one flagged. "Sign out everywhere" ends every session, including this one, so send the user to sign in afterwards.

## 9. Things the backend never sends back

Tokens appear only in the sign in, verify code and refresh answers. The PIN, the BVN and sign in codes never come back in any answer or audit entry, so the frontend must not expect to show them, and must not store the PIN anywhere.

## 10. Identity and profile

- `GET /api/me` needs only a signed-in session. It returns the user's id and phone, display name, BVN and PIN onboarding flags, and whether onboarding is complete. It also carries `receiving_account`, which is `null` until the user chooses a default receiving account in R3.
- `PUT /api/me/profile` needs a signed-in session and accepts only `display_name`. Names are trimmed and must contain 1 to 80 characters. The answer is the same user shape used by auth.
- Display name can also be submitted in the PIN setup body as `display_name`, so a sign-up screen can capture it during onboarding. It can instead be set or changed later through the profile endpoint.

## 11. Receiving account and user lookup

- `PUT /api/me/receiving-account` accepts `account_id` and requires a signed-in, onboarded user. The account must belong to that user and be active. A missing or foreign account answers `404 not_found`.
- `GET /api/me` now carries `receiving_account` when it is set, or `null` when it is not.
- `GET /api/users/lookup?phone=` requires sign-in. It normalizes Nigerian phone formats. It answers only `recipient_type: "apapo"` and a masked display name such as `Ada O.`.
- Unknown users, users still onboarding, users without display names and users without a receiving account answer `404 not_found`. The response never includes the phone, BVN, account, PIN or full name. Lookup is rate limited with `429 rate_limited` and `Retry-After`.

## 12. Sending to another Apapo user

- For Split-Pay preview and execute, send `recipient.apapo_phone` instead of bank and account fields. Never send the resolved account.
- Preview returns `recipient.recipient_type: "apapo"` and `recipient.masked_display_name`, for example `Bola A.`. The response does not return the recipient account ID or full account number.
- Apapo recipients with a verified display name can reach Safe Send low tier when reports and warning flags are clear. Existing scam reports still apply.
- Execute uses the same PIN, Idempotency-Key, daily limit and rollback rules as outside Split-Pay.
- `400 self_send` means the phone belongs to the signed-in sender. `404 not_found` means the phone is unknown, not onboarded or has no receiving account.
- The recipient receives a bank-confirmed P2P credit in their dashboard feed. P2P references start with `p2p_` and are not Apapo collection or reversal movements.

## 14. Safe Send and Shield for R8

- A clean known Apapo recipient can show low risk. Reports against the recipient's receiving account still force high risk once enough independent reports exist.
- A P2P recipient stays unknown or warning-tier if name mismatch, unusual amount or duplicate-payment signals exist.
- Outside account recipients keep the existing bank name and report rules. The UI must still show high/unknown/low warnings as before.
- Shield ignores bank transactions whose reference starts with `pay_`, `rev_`, `sr_`, or `p2p_`. These are Apapo collection, reversal, Split-Receive or P2P movements, not unconfirmed outside credits.

## 13. Payment history and recent recipients

- `GET /api/payments` needs sign-in and onboarding. It lists only the signed-in user's sent payments, newest first.
- Query `limit` from 1 to 100, default 20. Pass `next_before` from the response back as `before` to get older payments. Unknown or foreign `before` values return an empty page, never other users' payments.
- Payment rows carry id, state, amount, fee, recipient, and timestamps. P2P recipients show only recipient type and masked display name. Outside recipients show bank code and masked account number.
- `GET /api/recipients/recent` needs sign-in and onboarding. It lists distinct recent recipients, deduplicated by Apapo phone or outside bank/account pair, newest first.
- A user never sees recipients or payments belonging to another user.

## 15. Demo helpers (R9)

- The demo failure switch has a new kind, `reversal_down`, which only the demo script needs. The real screens do not call it.
- To show hold and retry on screen, poll the payment status. It moves from needs attention to rolled back by itself, usually within about 10 seconds after the fault clears. Show "your money is safe, we are retrying" while it waits, and never show it as failed.
- Demo run order is in the README. Two users are seeded: Samuel (`08012345678`) and Bola (`08098765432`). Restart the mock server between full runs because the money really moves.
