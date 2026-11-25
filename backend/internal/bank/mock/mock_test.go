package mock

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
)

var fixedNow = func() time.Time { return time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC) }

func seeded() *Provider {
	p := New(fixedNow)
	Seed(p)
	return p
}

func TestSeedReturnsFourBanks(t *testing.T) {
	accs, err := seeded().GetAccounts(context.Background(), DemoUserID)
	if err != nil || len(accs) != 4 {
		t.Fatalf("want 4 accounts, got %d err %v", len(accs), err)
	}
	var total bank.Kobo
	for _, a := range accs {
		total += a.BalanceKobo
	}
	if total != 19_500_000 {
		t.Fatalf("total balance %d", total)
	}
}

func TestSeedHistoryShowsTransportShift(t *testing.T) {
	p := seeded()
	now := fixedNow()
	sum := func(from, to time.Time) bank.Kobo {
		txs, _ := p.GetTransactions(context.Background(), "acc_apex_1", from, to)
		var s bank.Kobo
		for _, x := range txs {
			if x.Narration == "BOLT RIDE LAGOS" {
				s += x.AmountKobo
			}
		}
		return s
	}
	cur := sum(now.AddDate(0, 0, -30), now.Add(time.Hour))
	prev := sum(now.AddDate(0, 0, -60), now.AddDate(0, 0, -30))
	if prev == 0 || cur*100/prev < 135 || cur*100/prev > 145 {
		t.Fatalf("transport shift not about 40 percent: cur %d prev %d", cur, prev)
	}
}

func TestTransferMovesMoneyAndIsIdempotent(t *testing.T) {
	p := seeded()
	ctx := context.Background()
	req := bank.TransferRequest{FromAccountID: "acc_apex_1", To: bank.Destination{AccountID: "acc_delta_1"}, AmountKobo: 1_000_000, Reference: "r1"}
	r1, err := p.Transfer(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	r2, _ := p.Transfer(ctx, req)
	if r1.TransferID != r2.TransferID {
		t.Fatal("same reference must return the same transfer")
	}
	a, _ := p.GetBalance(ctx, "acc_apex_1")
	d, _ := p.GetBalance(ctx, "acc_delta_1")
	if a != 6_000_000 || d != 7_000_000 {
		t.Fatalf("balances %d %d", a, d)
	}
}

func TestTransferErrors(t *testing.T) {
	p := seeded()
	ctx := context.Background()
	to := bank.Destination{AccountNumber: "0123456789", BankCode: "ext"}
	cases := []struct {
		name string
		req  bank.TransferRequest
		pre  func()
		want error
	}{
		{"insufficient", bank.TransferRequest{FromAccountID: "acc_harbor_1", To: to, AmountKobo: 99_000_000, Reference: "a"}, nil, bank.ErrInsufficientFunds},
		{"bad amount", bank.TransferRequest{FromAccountID: "acc_harbor_1", To: to, AmountKobo: 0, Reference: "b"}, nil, bank.ErrInvalidAmount},
		{"unknown account", bank.TransferRequest{FromAccountID: "nope", To: to, AmountKobo: 1, Reference: "c"}, nil, bank.ErrAccountNotFound},
		{"bank down", bank.TransferRequest{FromAccountID: "acc_savanna_1", To: to, AmountKobo: 1, Reference: "d"}, func() { p.SetBankFailure("savanna", FailBankDown) }, bank.ErrBankUnavailable},
		{"timeout", bank.TransferRequest{FromAccountID: "acc_delta_1", To: to, AmountKobo: 1, Reference: "e"}, func() { p.SetAccountFailure("acc_delta_1", FailTimeout) }, bank.ErrTimeout},
	}
	for _, c := range cases {
		if c.pre != nil {
			c.pre()
		}
		if _, err := p.Transfer(ctx, c.req); !errors.Is(err, c.want) {
			t.Errorf("%s: got %v want %v", c.name, err, c.want)
		}
	}
}

func TestBankDownAffectsReadsAndClears(t *testing.T) {
	p := seeded()
	ctx := context.Background()
	p.SetBankFailure("delta", FailTimeout)
	if _, err := p.GetBalance(ctx, "acc_delta_1"); !errors.Is(err, bank.ErrTimeout) {
		t.Fatalf("got %v", err)
	}
	p.SetBankFailure("delta", FailNone)
	if _, err := p.GetBalance(ctx, "acc_delta_1"); err != nil {
		t.Fatal(err)
	}
}

func TestReverseTransfer(t *testing.T) {
	p := seeded()
	ctx := context.Background()
	r, _ := p.Transfer(ctx, bank.TransferRequest{FromAccountID: "acc_apex_1", To: bank.Destination{AccountID: "acc_delta_1"}, AmountKobo: 500_000, Reference: "x"})
	if err := p.ReverseTransfer(ctx, r.TransferID); err != nil {
		t.Fatal(err)
	}
	a, _ := p.GetBalance(ctx, "acc_apex_1")
	d, _ := p.GetBalance(ctx, "acc_delta_1")
	if a != 7_000_000 || d != 6_000_000 {
		t.Fatalf("not restored: %d %d", a, d)
	}
	if err := p.ReverseTransfer(ctx, r.TransferID); !errors.Is(err, bank.ErrAlreadyReversed) {
		t.Fatalf("got %v", err)
	}
	if err := p.ReverseTransfer(ctx, "missing"); !errors.Is(err, bank.ErrTransferNotFound) {
		t.Fatalf("got %v", err)
	}
}

func TestP2PTransferCreatesConfirmedCredit(t *testing.T) {
	p := seeded()
	ctx := context.Background()
	req := bank.TransferRequest{
		FromAccountID: "acc_apex_1",
		To:            bank.Destination{AccountID: "acc_demo2_apex_1"},
		AmountKobo:    1_000_000,
		Reference:     "p2p_pay_test",
	}
	first, err := p.Transfer(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	second, err := p.Transfer(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if first.TransferID != second.TransferID {
		t.Fatal("P2P reference retry should be idempotent")
	}
	txs, err := p.GetTransactions(ctx, "acc_demo2_apex_1", time.Time{}, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, tx := range txs {
		if tx.Direction == bank.Credit && tx.AmountKobo == 1_000_000 && tx.Verified && tx.Reference == "p2p_pay_test" {
			found = true
		}
	}
	if !found {
		t.Fatalf("confirmed P2P credit missing: %+v", txs)
	}
}

func TestReversalDownFailsReversalButNotTransfers(t *testing.T) {
	p := seeded()
	ctx := context.Background()
	p.SetBankReversalFailure("delta", true)
	r, err := p.Transfer(ctx, bank.TransferRequest{FromAccountID: "acc_apex_1", To: bank.Destination{AccountID: "acc_delta_1"}, AmountKobo: 500_000, Reference: "rd"})
	if err != nil {
		t.Fatalf("normal transfers must keep working: %v", err)
	}
	if err := p.ReverseTransfer(ctx, r.TransferID); !errors.Is(err, bank.ErrBankUnavailable) {
		t.Fatalf("reversal should fail while reversal_down is on, got %v", err)
	}
	a, _ := p.GetBalance(ctx, "acc_apex_1")
	if a != 6_500_000 {
		t.Fatalf("failed reversal must not move money: %d", a)
	}
	p.SetBankReversalFailure("delta", false)
	if err := p.ReverseTransfer(ctx, r.TransferID); err != nil {
		t.Fatalf("reversal should work once cleared: %v", err)
	}
	a, _ = p.GetBalance(ctx, "acc_apex_1")
	if a != 7_000_000 {
		t.Fatalf("not restored: %d", a)
	}
}
