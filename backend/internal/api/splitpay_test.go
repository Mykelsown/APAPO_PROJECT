package api

import (
	"bytes"
	"context"
	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/limits"
	"github.com/Mykelsown/apapo/backend/internal/safesend"
	"github.com/Mykelsown/apapo/backend/internal/splitreceive"
	"time"

	"encoding/json"
	"github.com/Mykelsown/apapo/backend/internal/audit"
	"github.com/Mykelsown/apapo/backend/internal/categorize"
	"github.com/Mykelsown/apapo/backend/internal/links"
	"github.com/Mykelsown/apapo/backend/internal/secrets"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Mykelsown/apapo/backend/internal/auth"
	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
	"github.com/Mykelsown/apapo/backend/internal/payments"
)

// testToken is the access token of the onboarded demo user created by handler().
var testToken string

func newAuthService() *auth.Service {
	auth.PINArgon2 = auth.Argon2Params{MemoryKiB: 64, Time: 1, Threads: 1}
	svc := auth.New(auth.NewMemoryStore(), []byte("test-secret"))
	svc.FixedOTP, svc.DemoPhone, svc.DemoUserID = "123456", "+2348012345678", mock.DemoUserID
	return svc
}

func handler() (http.Handler, *mock.Provider) { return handlerWith(nil) }

// handlerWith builds the test server, letting a test adjust the dependencies first.
func handlerWith(adjust func(*Deps)) (http.Handler, *mock.Provider) {
	p := mock.New(nil)
	mock.Seed(p)
	st := payments.NewMemoryStore()
	ex := payments.NewExecutor(p, st)
	ex.RetryDelay = 0
	box, _ := secrets.New(bytes.Repeat([]byte{9}, 32))
	aud := audit.NewMemory()
	lk := &links.Service{Store: links.NewMemoryStore(), Linker: p, Catalog: mock.Catalog(), Box: box, Audit: aud, Now: time.Now}
	d := Deps{Provider: p, Linker: p, Links: lk, Audit: aud, SplitReceive: newSplitReceive(p, lk), SafeSend: newSafeSend(p), Categories: &categorize.Service{Store: categorize.NewMemoryStore(), Now: time.Now}, Executor: ex, Store: st, Mock: p, Limits: newLimits(st, lk, p), Auth: newAuthService(), Async: func(f func()) { f() }}
	if adjust != nil {
		adjust(&d)
	}
	h := New(d)
	testToken = onboard(h, "08012345678", "22222222222", "4821")
	for _, code := range []string{"apex", "delta", "savanna", "harbor"} {
		send(h, "POST", "/api/banks/link", testToken, `{"bank_code":"`+code+`","consent":{"accepted":true,"scopes":["accounts","balances","transactions"]}}`)
	}
	return h, p
}

// onboard runs the whole sign up flow and returns the access token.
func onboard(h http.Handler, phone, bvn, pin string) string {
	call := func(path, token, body string) map[string]any {
		req := httptest.NewRequest("POST", path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var out map[string]any
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	call("/api/auth/otp", "", `{"phone":"`+phone+`"}`)
	tok, _ := call("/api/auth/verify-otp", "", `{"phone":"`+phone+`","code":"123456"}`)["access_token"].(string)
	call("/api/auth/bvn", tok, `{"bvn":"`+bvn+`"}`)
	call("/api/auth/pin", tok, `{"pin":"`+pin+`"}`)
	return tok
}

func post(h http.Handler, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/api/splitpay/preview", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

const recipient = `"recipient":{"bank_code":"apex","account_number":"0123456789"}`

func TestPreviewThreeWaySplit(t *testing.T) {
	h, _ := handler()
	rec := post(h, `{"amount_kobo":15000000,`+recipient+`}`)
	if rec.Code != 200 {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	var out struct {
		Legs []struct {
			AccountNumber string `json:"account_number"`
			AmountKobo    int64  `json:"amount_kobo"`
		}
		TotalFee   int64 `json:"total_fee_kobo"`
		TotalDebit int64 `json:"total_debit_kobo"`
		Risk       struct{ Tier string }
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Legs) != 3 || out.TotalDebit != 15_000_000+out.TotalFee || out.Risk.Tier != "unknown" {
		t.Fatalf("unexpected %+v", out)
	}
	if !strings.HasPrefix(out.Legs[0].AccountNumber, "******") {
		t.Fatalf("account number not masked: %s", out.Legs[0].AccountNumber)
	}
}

func TestPreviewErrors(t *testing.T) {
	h, p := handler()
	tests := []struct {
		name, body string
		status     int
		code       string
	}{
		{"bad json", `{`, 400, "invalid_json"},
		{"zero amount", `{"amount_kobo":0,` + recipient + `}`, 400, "invalid_amount"},
		{"bad recipient", `{"amount_kobo":100,"recipient":{"bank_code":"apex","account_number":"12"}}`, 400, "invalid_recipient"},
		{"bad strategy", `{"amount_kobo":100,"strategy":"x",` + recipient + `}`, 400, "invalid_strategy"},
		{"unknown field", `{"amount_kobo":100,"nope":1,` + recipient + `}`, 400, "invalid_json"},
		{"insufficient", `{"amount_kobo":99000000,` + recipient + `}`, 422, "insufficient_funds"},
		{"too many legs", `{"amount_kobo":15000000,"max_legs":2,` + recipient + `}`, 422, "too_many_legs"},
	}
	for _, tc := range tests {
		rec := post(h, tc.body)
		var e struct{ Error struct{ Code string } }
		json.Unmarshal(rec.Body.Bytes(), &e)
		if rec.Code != tc.status || e.Error.Code != tc.code {
			t.Errorf("%s: got %d %s", tc.name, rec.Code, rec.Body)
		}
	}
	// A bank that is down is skipped, not fatal: the others still plan the payment.
	p.SetBankFailure("apex", mock.FailBankDown)
	if rec := post(h, `{"amount_kobo":100,`+recipient+`}`); rec.Code != 200 {
		t.Errorf("one bank down should still plan, got %d", rec.Code)
	}
}

func TestHealth(t *testing.T) {
	h, _ := handler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/healthz", nil))
	if rec.Code != 200 {
		t.Fatal(rec.Code)
	}
}

func execute(h http.Handler, key, body string) *httptest.ResponseRecorder {
	if !strings.Contains(body, `"pin"`) && strings.HasPrefix(body, "{") {
		body = `{"pin":"4821",` + body[1:]
	}
	return executeRaw(h, key, body)
}

func executeRaw(h http.Handler, key, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/api/splitpay/execute", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testToken)
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func status(h http.Handler, id string) map[string]any {
	req := httptest.NewRequest("GET", "/api/splitpay/"+id, nil)
	req.Header.Set("Authorization", "Bearer "+testToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return out
}

func TestExecuteCompletesAndStatusShowsLegs(t *testing.T) {
	h, _ := handler()
	body := `{"amount_kobo":15000000,` + recipient + `}`
	rec := execute(h, "key-12345678", body)
	if rec.Code != 202 {
		t.Fatalf("status %d %s", rec.Code, rec.Body)
	}
	var created map[string]any
	json.Unmarshal(rec.Body.Bytes(), &created)
	got := status(h, created["id"].(string))
	if got["state"] != "completed" || len(got["legs"].([]any)) != 3 {
		t.Fatalf("got %v", got)
	}
	// A repeat of the same key returns the same payment and moves no more money.
	again := execute(h, "key-12345678", body)
	var dup map[string]any
	json.Unmarshal(again.Body.Bytes(), &dup)
	if again.Code != 200 || dup["id"] != created["id"] {
		t.Fatalf("repeat: %d %v", again.Code, dup)
	}
}

func TestExecuteRollbackThroughDemoSwitch(t *testing.T) {
	h, _ := handler()
	sw := httptest.NewRecorder()
	h.ServeHTTP(sw, httptest.NewRequest("POST", "/api/demo/failure", strings.NewReader(`{"account_id":"acc_savanna_1","mode":"bank_down"}`)))
	if sw.Code != 200 {
		t.Fatalf("switch %d %s", sw.Code, sw.Body)
	}
	rec := execute(h, "key-rollback1", `{"amount_kobo":15000000,`+recipient+`}`)
	var created map[string]any
	json.Unmarshal(rec.Body.Bytes(), &created)
	got := status(h, created["id"].(string))
	if got["state"] != "rolled_back" || got["message"] != payments.MsgRolledBack {
		t.Fatalf("got %v", got)
	}
}

func TestExecuteValidation(t *testing.T) {
	h, _ := handler()
	body := `{"amount_kobo":100,` + recipient + `}`
	if rec := execute(h, "", body); rec.Code != 400 {
		t.Errorf("missing key should be 400, got %d", rec.Code)
	}
	execute(h, "key-conflict1", body)
	other := `{"amount_kobo":200,` + recipient + `}`
	if rec := execute(h, "key-conflict1", other); rec.Code != 409 {
		t.Errorf("reused key should be 409, got %d", rec.Code)
	}
	req := httptest.NewRequest("GET", "/api/splitpay/pay_missing", nil)
	req.Header.Set("Authorization", "Bearer "+testToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 404 {
		t.Errorf("unknown payment should be 404, got %d", rec.Code)
	}
}

func setupP2PUser(t *testing.T, h http.Handler, phone, pin, displayName string) (token, accountID string) {
	t.Helper()
	token = onboard(h, phone, "22222222222", pin)
	code, _ := send(h, "PUT", "/api/me/profile", token, `{"display_name":"`+displayName+`"}`)
	if code != 200 {
		t.Fatalf("set P2P profile: %d", code)
	}
	code, _ = send(h, "POST", "/api/banks/link", token, `{"bank_code":"apex","consent":{"accepted":true,"scopes":["accounts","balances","transactions"]}}`)
	if code != 201 {
		t.Fatalf("link P2P bank: %d", code)
	}
	code, accounts := send(h, "GET", "/api/accounts", token, "")
	if code != 200 {
		t.Fatalf("list P2P accounts: %d", code)
	}
	accountList := accounts["accounts"].([]any)
	accountID = accountList[0].(map[string]any)["id"].(string)
	code, _ = send(h, "PUT", "/api/me/receiving-account", token, `{"account_id":"`+accountID+`"}`)
	if code != 200 {
		t.Fatalf("set P2P receiving account: %d", code)
	}
	return token, accountID
}

func TestP2PHappyPathAndPrivacy(t *testing.T) {
	h, p := handler()
	recipientToken, recipientAccountID := setupP2PUser(t, h, "08099990021", "5912", "Bola Adeyemi")

	body := `{"amount_kobo":1000000,"recipient":{"apapo_phone":"08099990021"}}`
	rec := post(h, body)
	if rec.Code != 200 {
		t.Fatalf("P2P preview: %d %s", rec.Code, rec.Body)
	}
	var preview map[string]any
	json.Unmarshal(rec.Body.Bytes(), &preview)
	recipient := preview["recipient"].(map[string]any)
	if recipient["recipient_type"] != "apapo" || recipient["masked_display_name"] != "Bola A." {
		t.Fatalf("P2P preview recipient: %v", preview)
	}
	if preview["risk"].(map[string]any)["tier"] != "low" {
		t.Fatalf("known Apapo recipient should be low: %v", preview["risk"])
	}
	before, err := p.GetBalance(context.Background(), recipientAccountID)
	if err != nil {
		t.Fatal(err)
	}

	exec := execute(h, "key-p2p-happy1", body)
	if exec.Code != 202 {
		t.Fatalf("P2P execute: %d %s", exec.Code, exec.Body)
	}
	var created map[string]any
	json.Unmarshal(exec.Body.Bytes(), &created)
	payment := status(h, created["id"].(string))
	if payment["state"] != "completed" {
		t.Fatalf("P2P state: %v", payment)
	}

	again := execute(h, "key-p2p-happy1", body)
	var duplicate map[string]any
	json.Unmarshal(again.Body.Bytes(), &duplicate)
	if again.Code != 200 || duplicate["id"] != created["id"] {
		t.Fatalf("P2P retry: %d %v", again.Code, duplicate)
	}
	after, err := p.GetBalance(context.Background(), recipientAccountID)
	if err != nil {
		t.Fatal(err)
	}
	if after != before+1_000_000 {
		t.Fatalf("recipient balance expected one P2P credit: before=%d after=%d", before, after)
	}
	code, dashboard := send(h, "GET", "/api/dashboard?limit=100", recipientToken, "")
	if code != 200 {
		t.Fatalf("recipient dashboard: %d %v", code, dashboard)
	}
	foundP2P := false
	for _, row := range dashboard["feed"].(map[string]any)["items"].([]any) {
		r := row.(map[string]any)
		if r["account_id"] == recipientAccountID && r["direction"] == "credit" && r["amount_kobo"].(float64) == 1_000_000 {
			if r["verification"] == "confirmed" {
				foundP2P = true
			}
		}
	}
	if !foundP2P {
		t.Fatalf("recipient P2P credit missing from dashboard: %v", dashboard)
	}

	recipientLookupStatus, recipientLookup := send(h, "GET", "/api/users/lookup?phone=08099990021", testToken, "")
	if recipientLookupStatus != 200 {
		t.Fatalf("recipient lookup: %d %v", recipientLookupStatus, recipientLookup)
	}
	if _, exists := recipientLookup["account"]; exists {
		t.Fatalf("lookup returned account data: %v", recipientLookup)
	}
}

func TestP2PAuditForSenderAndRecipient(t *testing.T) {
	var auditLog *audit.Memory
	h, _ := handlerWith(func(d *Deps) {
		auditLog = audit.NewMemory()
		d.Audit = auditLog
		d.Executor.Logger = auditLog
	})
	_, recipientAccountID := setupP2PUser(t, h, "08099990024", "5912", "Audit Recipient")
	if recipientAccountID == "" {
		t.Fatal("missing recipient account")
	}
	body := `{"amount_kobo":100000,"recipient":{"apapo_phone":"08099990024"}}`
	rec := execute(h, "key-p2p-audit1", body)
	if rec.Code != 202 {
		t.Fatalf("P2P execute: %d %s", rec.Code, rec.Body)
	}
	entries := auditLog.All()
	senderEntry, recipientEntry := false, false
	for _, entry := range entries {
		if entry.UserID == mock.DemoUserID && entry.Event == "payment.state" {
			senderEntry = true
		}
		if entry.Event == "p2p.credit_confirmed" {
			recipientEntry = entry.UserID != ""
		}
	}
	if !senderEntry || !recipientEntry {
		t.Fatalf("P2P audit missing: sender=%v recipient=%v entries=%v", senderEntry, recipientEntry, entries)
	}
}

func TestP2PRecipientErrors(t *testing.T) {
	h, _ := handler()

	if rec := post(h, `{"amount_kobo":100000,"recipient":{"apapo_phone":"08012345678"}}`); rec.Code != 400 {
		t.Fatalf("self send preview: %d %s", rec.Code, rec.Body)
	}
	if rec := post(h, `{"amount_kobo":100000,"recipient":{"apapo_phone":"08099999999"}}`); rec.Code != 404 {
		t.Fatalf("unknown recipient preview: %d %s", rec.Code, rec.Body)
	}
	withoutAccount := onboard(h, "08099990022", "22222222222", "5912")
	send(h, "PUT", "/api/me/profile", withoutAccount, `{"display_name":"No Account"}`)
	if rec := post(h, `{"amount_kobo":100000,"recipient":{"apapo_phone":"08099990022"}}`); rec.Code != 404 {
		t.Fatalf("no receiving account: %d %s", rec.Code, rec.Body)
	}
}

func newSplitReceive(p *mock.Provider, lk *links.Service) *splitreceive.Service {
	return &splitreceive.Service{
		Store: splitreceive.NewMemoryStore(), Provider: p, Audit: audit.NewMemory(), Now: time.Now,
		Accounts: func(ctx context.Context, userID string) ([]bank.Account, error) {
			active, _ := lk.Active(ctx, userID)
			var out []bank.Account
			for _, l := range active {
				a, err := p.AccountsAt(ctx, userID, l.BankCode)
				if err == nil {
					out = append(out, a...)
				}
			}
			return out, nil
		},
	}
}

func newSafeSend(p *mock.Provider) *safesend.Service {
	svc := &safesend.Service{Store: safesend.NewMemoryStore(), Salt: []byte("salt"), Now: time.Now, ResolveName: p.ResolveName}
	for _, r := range mock.DemoRecipients {
		if r.Kind == "flagged" {
			svc.SeedFlagged(context.Background(), safesend.Recipient{BankCode: r.BankCode, AccountNumber: r.AccountNumber})
		}
	}
	return svc
}

func newLimits(st payments.Store, lk *links.Service, p *mock.Provider) *limits.Service {
	return &limits.Service{Store: limits.NewMemoryStore(), Now: time.Now, Sources: []limits.Spent{
		func(ctx context.Context, userID string, since time.Time) (int64, error) {
			recent, _ := st.Recent(ctx, userID, 500)
			time.Sleep(time.Millisecond) // a realistic gap between reading and paying, so races show up
			var sum int64
			for _, x := range recent {
				if !x.CreatedAt.Before(since) && x.State != payments.StateRolledBack {
					sum += x.AmountKobo
				}
			}
			return sum, nil
		},
	}}
}

func TestPaymentHistoryOwnershipAndPaging(t *testing.T) {
	h, _ := handler()

	first := execute(h, "key-history-1", `{"amount_kobo":100000,`+recipient+`}`)
	if first.Code != 202 {
		t.Fatalf("first payment: %d %s", first.Code, first.Body)
	}
	second := execute(h, "key-history-2", `{"amount_kobo":200000,`+recipient+`}`)
	if second.Code != 202 {
		t.Fatalf("second payment: %d %s", second.Code, second.Body)
	}

	code, page := send(h, "GET", "/api/payments?limit=1", testToken, "")
	if code != 200 {
		t.Fatalf("payment history: %d %v", code, page)
	}
	paymentsList := page["payments"].([]any)
	if len(paymentsList) != 1 || page["next_before"] == nil {
		t.Fatalf("page one: %v", page)
	}
	cursor := page["next_before"].(string)
	code, pageTwo := send(h, "GET", "/api/payments?limit=1&before="+cursor, testToken, "")
	if code != 200 {
		t.Fatalf("payment history page two: %d %v", code, pageTwo)
	}
	if len(pageTwo["payments"].([]any)) != 1 {
		t.Fatalf("page two: %v", pageTwo)
	}

	otherToken := onboard(h, "08099990031", "22222222222", "5912")
	code, other := send(h, "GET", "/api/payments", otherToken, "")
	if code != 200 {
		t.Fatalf("other user's history: %d %v", code, other)
	}
	if len(other["payments"].([]any)) != 0 {
		t.Fatalf("other user saw sent payments: %v", other)
	}
	if code, _ := send(h, "GET", "/api/payments?before=not-their-id", otherToken, ""); code != 200 {
		t.Fatalf("other user's cursor should not reveal data: %d", code)
	}
}

func TestRecentRecipientsApapoAndOutside(t *testing.T) {
	h, _ := handler()

	if rec := execute(h, "key-recent-outside", `{"amount_kobo":100000,`+recipient+`}`); rec.Code != 202 {
		t.Fatalf("outside payment: %d %s", rec.Code, rec.Body)
	}
	recipientToken, _ := setupP2PUser(t, h, "08099990032", "5912", "Recent User")
	if rec := execute(h, "key-recent-apapo", `{"amount_kobo":100000,"recipient":{"apapo_phone":"08099990032"}}`); rec.Code != 202 {
		t.Fatalf("Apapo payment: %d %s", rec.Code, rec.Body)
	}

	code, out := send(h, "GET", "/api/recipients/recent", testToken, "")
	if code != 200 {
		t.Fatalf("recent recipients: %d %v", code, out)
	}
	recipients := out["recipients"].([]any)
	if len(recipients) < 2 {
		t.Fatalf("recent recipient types missing: %v", out)
	}
	seenApapo, seenOutside := false, false
	for _, r := range recipients {
		m := r.(map[string]any)
		if m["recipient_type"] == "apapo" {
			seenApapo = true
			if _, exists := m["account_number"]; exists {
				t.Fatalf("Apapo recipient leaked account: %v", m)
			}
		}
		if m["recipient_type"] == "outside" {
			seenOutside = true
		}
	}
	if !seenApapo || !seenOutside {
		t.Fatalf("recent recipients: %+v", recipients)
	}

	code, other := send(h, "GET", "/api/recipients/recent", recipientToken, "")
	if code != 200 {
		t.Fatalf("recipient's recent recipients: %d %v", code, other)
	}
	if len(other["recipients"].([]any)) != 0 {
		t.Fatalf("recipient saw sender's recipients: %v", other)
	}
}

func TestDemoReversalDownHoldsPaymentThenRetrySucceeds(t *testing.T) {
	var ex *payments.Executor
	h, _ := handlerWith(func(d *Deps) { ex = d.Executor; ex.ReversalRetryBase = 0 })
	demo := func(body string) int {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/demo/failure", strings.NewReader(body)))
		return rec.Code
	}
	if c := demo(`{"account_id":"acc_delta_1","mode":"reversal_down"}`); c != 400 {
		t.Fatalf("reversal_down without a bank_code must be 400, got %d", c)
	}
	if c := demo(`{"bank_code":"delta","mode":"reversal_down"}`); c != 200 {
		t.Fatalf("reversal_down switch: %d", c)
	}
	if c := demo(`{"account_id":"acc_savanna_1","mode":"insufficient_funds"}`); c != 200 {
		t.Fatalf("account switch: %d", c)
	}
	rec := execute(h, "key-hold-retry1", `{"amount_kobo":15000000,`+recipient+`}`)
	var created map[string]any
	json.Unmarshal(rec.Body.Bytes(), &created)
	got := status(h, created["id"].(string))
	if got["state"] != "needs_attention" {
		t.Fatalf("a stuck reversal must hold the payment in needs_attention: %v", got)
	}
	// Clearing the switch lets the next retry finish the reversal.
	if c := demo(`{"bank_code":"delta","mode":"none"}`); c != 200 {
		t.Fatalf("clear: %d", c)
	}
	if err := ex.RescanUnfinished(context.Background()); err != nil {
		t.Fatal(err)
	}
	got = status(h, created["id"].(string))
	if got["state"] != "rolled_back" {
		t.Fatalf("retry should finish the rollback: %v", got)
	}
}
