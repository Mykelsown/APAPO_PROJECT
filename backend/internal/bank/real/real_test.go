package real

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
)

var ctx = context.Background()

func newProv(t *testing.T, h http.HandlerFunc, mutate func(*Config)) *Provider {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	cfg := Config{BaseURL: srv.URL, APIKey: "key123", RetryDelay: time.Millisecond, ReadRetries: 2}
	if mutate != nil {
		mutate(&cfg)
	}
	p, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func TestNeedsURLAndKey(t *testing.T) {
	if _, err := New(Config{}); err == nil {
		t.Fatal("empty config accepted")
	}
}

func TestAccountsMappedAndAuthSent(t *testing.T) {
	p := newProv(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer key123" || r.URL.Query().Get("user_id") != "u1" {
			reply(w, 401, apiError{Code: "unauthorized"})
			return
		}
		reply(w, 200, map[string]any{"accounts": []wireAccount{{ID: "a1", BankCode: "examplebank", BankName: "Example Bank", AccountNumber: "0123456789", BalanceKobo: 500}}})
	}, nil)
	accs, err := p.GetAccounts(ctx, "u1")
	if err != nil || len(accs) != 1 || accs[0].BalanceKobo != 500 || accs[0].BankName != "Example Bank" {
		t.Fatalf("%v %+v", err, accs)
	}
}

func TestReadsRetryTemporaryFailuresThenSucceed(t *testing.T) {
	var calls atomic.Int32
	p := newProv(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) < 3 {
			reply(w, 503, apiError{Code: "down"})
			return
		}
		reply(w, 200, map[string]any{"balance_kobo": 9000})
	}, nil)
	bal, err := p.GetBalance(ctx, "a1")
	if err != nil || bal != 9000 || calls.Load() != 3 {
		t.Fatalf("bal %d err %v calls %d", bal, err, calls.Load())
	}
}

func TestReadGivesUpAfterRetries(t *testing.T) {
	var calls atomic.Int32
	p := newProv(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); reply(w, 503, apiError{}) }, nil)
	if _, err := p.GetBalance(ctx, "a1"); !errors.Is(err, bank.ErrBankUnavailable) || calls.Load() != 3 {
		t.Fatalf("err %v calls %d", err, calls.Load())
	}
}

func TestTransferIsNeverRetriedAndCarriesIdempotencyKey(t *testing.T) {
	var calls atomic.Int32
	var key string
	p := newProv(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		key = r.Header.Get("Idempotency-Key")
		reply(w, 503, apiError{Code: "down"})
	}, nil)
	_, err := p.Transfer(ctx, bank.TransferRequest{FromAccountID: "a1", AmountKobo: 100, Reference: "pay_1-leg-1"})
	if !errors.Is(err, bank.ErrBankUnavailable) || calls.Load() != 1 || key != "pay_1-leg-1" {
		t.Fatalf("err %v calls %d key %q", err, calls.Load(), key)
	}
	if _, err := p.Transfer(ctx, bank.TransferRequest{FromAccountID: "a1", AmountKobo: 100}); err == nil {
		t.Fatal("transfer without a reference must be refused")
	}
	if _, err := p.Transfer(ctx, bank.TransferRequest{FromAccountID: "a1", Reference: "r"}); !errors.Is(err, bank.ErrInvalidAmount) {
		t.Fatalf("zero amount: %v", err)
	}
}

func TestTransferSuccessAndErrorMapping(t *testing.T) {
	cases := []struct {
		status int
		code   string
		want   error
	}{
		{422, "insufficient_funds", bank.ErrInsufficientFunds},
		{404, "account_not_found", bank.ErrAccountNotFound},
		{504, "", bank.ErrTimeout},
		{500, "", bank.ErrBankUnavailable},
		{429, "", bank.ErrBankUnavailable},
	}
	for _, c := range cases {
		p := newProv(t, func(w http.ResponseWriter, r *http.Request) { reply(w, c.status, apiError{Code: c.code}) }, nil)
		if _, err := p.Transfer(ctx, bank.TransferRequest{FromAccountID: "a", AmountKobo: 1, Reference: "r"}); !errors.Is(err, c.want) {
			t.Errorf("%d %s: got %v want %v", c.status, c.code, err, c.want)
		}
	}
	p := newProv(t, func(w http.ResponseWriter, r *http.Request) {
		reply(w, 201, wireTransfer{TransferID: "t1", Reference: "r", AmountKobo: 700})
	}, nil)
	res, err := p.Transfer(ctx, bank.TransferRequest{FromAccountID: "a", AmountKobo: 700, Reference: "r"})
	if err != nil || res.TransferID != "t1" || res.AmountKobo != 700 {
		t.Fatalf("%v %+v", err, res)
	}
}

func TestSlowBankBecomesTimeout(t *testing.T) {
	p := newProv(t, func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		reply(w, 200, map[string]any{})
	},
		func(c *Config) { c.Timeout = 30 * time.Millisecond; c.ReadRetries = 0 })
	if _, err := p.GetBalance(ctx, "a1"); !errors.Is(err, bank.ErrTimeout) {
		t.Fatalf("got %v", err)
	}
}

func TestReverseAndLinkerCalls(t *testing.T) {
	var paths []string
	p := newProv(t, func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		if r.URL.Path == "/connections" && r.Method == "POST" {
			reply(w, 201, map[string]string{"connection_id": "c1", "access_token": "tok"})
			return
		}
		reply(w, 200, map[string]any{"accounts": []wireAccount{}})
	}, nil)
	if err := p.ReverseTransfer(ctx, "t1"); err != nil {
		t.Fatal(err)
	}
	res, err := p.LinkBank(ctx, "u1", "examplebank")
	if err != nil || res.ProviderRef != "c1" || res.Token != "tok" {
		t.Fatalf("%v %+v", err, res)
	}
	if _, err := p.AccountsAt(ctx, "u1", "examplebank"); err != nil {
		t.Fatal(err)
	}
	if err := p.Unlink(ctx, "u1", "examplebank"); err != nil {
		t.Fatal(err)
	}
	want := []string{"POST /transfers/t1/reverse", "POST /connections", "GET /accounts", "DELETE /connections"}
	for i, w := range want {
		if paths[i] != w {
			t.Errorf("call %d: got %s want %s", i, paths[i], w)
		}
	}
}
