#!/usr/bin/env bash
# Walks the whole Apapo demo against a running mock-mode API, with two users.
# Usage: scripts/demo.sh [base_url]   (server needs DEV_OTP=123456)
#
# User one (Samuel) pays; user two (Bola) receives and has Split-Receive rules.
# Money really moves in the mock, so restart the server (or use an empty database)
# before each run; a second run on the same data will run short of funds.
set -euo pipefail
BASE="${1:-http://localhost:8080}"
PHONE1="08012345678"; PIN1="4821"
PHONE2="08098765432"; PIN2="5912"
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
call() { # method path [body] [extra header]; uses $TOKEN
  curl -s -X "$1" "$BASE$2" -H "Authorization: Bearer ${TOKEN:-}" -H 'Content-Type: application/json' ${4:+-H "$4"} ${3:+-d "$3"}
}
step() { printf '\n== %s\n' "$1"; }
RUN="$(date +%s)"

signin() { # phone pin bvn: logs in, or does the full sign up on first run
  local R
  R=$(curl -s -X POST "$BASE/api/auth/login" -d "{\"phone\":\"$1\",\"pin\":\"$2\"}")
  if echo "$R" | grep -q access_token; then
    echo "$R" | j "d['access_token']"
  else # first run: full sign up (OTP sends are limited to 3 per 10 minutes)
    curl -s -X POST "$BASE/api/auth/otp" -d "{\"phone\":\"$1\"}" >/dev/null
    R=$(curl -s -X POST "$BASE/api/auth/verify-otp" -d "{\"phone\":\"$1\",\"code\":\"123456\"}")
    local T; T=$(echo "$R" | j "d['access_token']")
    curl -s -X POST "$BASE/api/auth/bvn" -H "Authorization: Bearer $T" -d '{"bvn":"22222222222"}' >/dev/null
    curl -s -X POST "$BASE/api/auth/pin" -H "Authorization: Bearer $T" -d "{\"pin\":\"$2\"}" >/dev/null
    echo "$T"
  fi
}
link_all() { # links the four banks for the current $TOKEN user
  for b in apex delta savanna harbor; do
    call POST /api/banks/link "{\"bank_code\":\"$b\",\"consent\":{\"accepted\":true,\"scopes\":[\"accounts\",\"balances\",\"transactions\"]}}" >/dev/null
  done
}
wait_state() { # payment id, wanted state, max seconds: polls until the state matches
  local i=0 S=""
  while [ "$i" -lt "$3" ]; do
    S=$(call GET "/api/splitpay/$1" | j "d['state']")
    [ "$S" = "$2" ] && break
    sleep 1; i=$((i+1))
  done
  echo "$S"
}

step "1. Two users sign in (phone, code, BVN and PIN only on first run)"
TOKEN1=$(signin "$PHONE1" "$PIN1"); TOKEN2=$(signin "$PHONE2" "$PIN2")
TOKEN="$TOKEN1"; call PUT /api/me/profile '{"display_name":"Samuel Pelumi"}' >/dev/null
TOKEN="$TOKEN1"; call GET /api/me | j "'user one: %s, onboarding complete: %s' % (d['display_name'], d['onboarding']['complete'])"
TOKEN="$TOKEN2"; call GET /api/me | j "'user two: %s, receives into: %s' % (d['display_name'], d['receiving_account']['bank_name'])"

step "2. User one links all four banks and sees one balance"
TOKEN="$TOKEN1"; link_all
call GET "/api/dashboard?limit=3" | j "'total balance (kobo): %s, banks: %d' % (d['total_balance_kobo'], len(d['banks']))"

step "3. User two links two more banks and sets Split-Receive: 30% to savings, 40% to spending"
TOKEN="$TOKEN2"
for b in delta savanna; do
  call POST /api/banks/link "{\"bank_code\":\"$b\",\"consent\":{\"accepted\":true,\"scopes\":[\"accounts\",\"balances\",\"transactions\"]}}" >/dev/null
done
call PUT /api/splitreceive/rules '{"receiving_account_id":"acc_demo2_apex_1","standing_consent":true,"pin":"'$PIN2'","destinations":[{"account_id":"acc_savanna_usr_demo2","percent":30},{"account_id":"acc_delta_usr_demo2","percent":40}]}' | j "'rules saved, destinations: %d' % len(d['rules']['destinations'])"

step "4. Send money to another Apapo user: lookup shows only a masked name"
TOKEN="$TOKEN1"
call GET "/api/users/lookup?phone=$PHONE2" | j "'found: %s (%s)' % (d['user']['display_name'], d['user']['recipient_type'])"
P2P='{"pin":"'$PIN1'","amount_kobo":2000000,"recipient":{"apapo_phone":"'$PHONE2'"}}'
call POST /api/splitpay/preview "$P2P" | j "'plan: %d legs, fee=%s, risk=%s, to=%s' % (len(d['legs']), d['total_fee_kobo'], d['risk']['tier'], d['recipient']['masked_display_name'])"
P=$(call POST /api/splitpay/execute "$P2P" "Idempotency-Key: demo-p2p-$RUN")
ID=$(echo "$P" | j "d['id']")
echo "N20,000 sent, state=$(wait_state "$ID" completed 10)"
echo "retrying with the same key returns the same payment, no double pay:"
call POST /api/splitpay/execute "$P2P" "Idempotency-Key: demo-p2p-$RUN" | j "'same payment id: %s' % (d['id'] == '$ID')"

step "5. User two's rules split the incoming credit, and the ledger balances"
TOKEN="$TOKEN2"
call POST /api/splitreceive/scan | j "'new runs: %s' % d['new_runs']"
call GET /api/reconciliation | j "'ledger totals: credit=%s sent=%s kept=%s held=%s' % (d['totals']['credit_kobo'], d['totals']['sent_kobo'], d['totals']['kept_kobo'], d['totals']['held_kobo'])"
call GET /api/reconciliation | j "'every credit balanced: %s' % all(c['balanced'] for c in d['credits'])"

step "6. Salary arrives for user two (simulated) and splits the same way"
call POST /api/demo/simulate-credit '{"amount_kobo":20000000,"sender_name":"Ada Stores"}' | j "'new runs: %s' % d['scan']['new_runs']"
call GET /api/reconciliation | j "'ledger totals: credit=%s sent=%s kept=%s' % (d['totals']['credit_kobo'], d['totals']['sent_kobo'], d['totals']['kept_kobo'])"

step "7. Safe Send: a reported account is flagged high"
TOKEN="$TOKEN1"
call POST /api/splitpay/preview '{"amount_kobo":15000000,"recipient":{"bank_code":"apex","account_number":"9000000001","account_name":"Quick Returns Investments"}}' | j "'risk=%s reasons=%s' % (d['risk']['tier'], d['risk']['reasons'])"
call POST /api/splitpay/preview "$P2P" | j "'a clean Apapo user: risk=%s' % d['risk']['tier']"

step "8. Rollback: a bank fails mid-payment and everything is undone"
BODY='{"pin":"'$PIN1'","amount_kobo":15000000,"recipient":{"bank_code":"delta","account_number":"1000000002","account_name":"Emeka Nwosu"}}'
PREV=$(call POST /api/splitpay/preview "$BODY")
echo "$PREV" | j "'plan: %d legs, fee=%s, risk=%s' % (len(d['legs']), d['total_fee_kobo'], d['risk']['tier'])"
LAST=$(echo "$PREV" | j "d['legs'][-1]['account_id']")
call POST /api/demo/failure "{\"account_id\":\"$LAST\",\"mode\":\"insufficient_funds\"}" >/dev/null
P=$(call POST /api/splitpay/execute "$BODY" "Idempotency-Key: demo-rollback-$RUN")
ID=$(echo "$P" | j "d['id']"); sleep 1
call GET "/api/splitpay/$ID" | j "'state=%s legs=%s' % (d['state'], [l['state'] for l in d['legs']])"

step "9. Hold and retry: a reversal fails, the money stays safe, Apapo keeps retrying"
COLLECTOR_BANK=$(echo "$PREV" | j "d['legs'][0]['bank_code']")
call POST /api/demo/failure "{\"bank_code\":\"$COLLECTOR_BANK\",\"mode\":\"reversal_down\"}" >/dev/null
P=$(call POST /api/splitpay/execute "$BODY" "Idempotency-Key: demo-hold-$RUN")
ID=$(echo "$P" | j "d['id']"); sleep 1
call GET "/api/splitpay/$ID" | j "'state=%s attempts=%s human_review=%s' % (d['state'], d['reversal_attempt_count'], d['human_review'])"
echo "the stuck leg stays collected (safe in your own collector account); clearing the fault..."
call POST /api/demo/failure "{\"bank_code\":\"$COLLECTOR_BANK\",\"mode\":\"none\"}" >/dev/null
call POST /api/demo/failure "{\"account_id\":\"$LAST\",\"mode\":\"none\"}" >/dev/null
echo "waiting for the retry worker (it checks every 10 seconds)..."
FINAL=$(wait_state "$ID" rolled_back 40)
call GET "/api/splitpay/$ID" | j "'state=%s attempts=%s legs=%s' % (d['state'], d['reversal_attempt_count'], [l['state'] for l in d['legs']])"
[ "$FINAL" = "rolled_back" ] || { echo "expected rolled_back, got $FINAL"; exit 1; }

step "10. Split-Pay N150,000 to an outside recipient, nothing failing"
P=$(call POST /api/splitpay/execute "$BODY" "Idempotency-Key: demo-pay-$RUN")
ID=$(echo "$P" | j "d['id']")
wait_state "$ID" completed 10 >/dev/null
call GET "/api/splitpay/$ID" | j "'state=%s legs=%s' % (d['state'], [l['state'] for l in d['legs']])"

step "11. Shield: an unconfirmed N80,000 credit"
call GET "/api/shield/check?amount_kobo=7800000" | j "d['alert'] and d['alert']['message']"

step "12. History and recent recipients (user one only)"
call GET "/api/payments?limit=5" | j "'recent payments: %s' % [(p['state'], p['recipient'].get('recipient_type', 'outside')) for p in d['payments']]"
call GET /api/recipients/recent | j "'recent recipients: %d' % len(d['recipients'])"

step "13. Privacy: user one cannot read user two's data"
TOKEN="$TOKEN1"
call GET /api/splitreceive/runs | j "'user one has %d split runs (user two has their own)' % len(d['runs'])"
echo
echo "Demo complete."
