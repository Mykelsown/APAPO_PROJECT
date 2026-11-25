package categorize

import (
	"context"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
)

func tx(narr, cp string, dir bank.Direction) bank.Transaction {
	return bank.Transaction{Narration: narr, Counterparty: cp, Direction: dir}
}

func TestRules(t *testing.T) {
	cases := []struct {
		t    bank.Transaction
		want string
	}{
		{tx("BOLT RIDE LAGOS", "Bolt", bank.Debit), "transport"},
		{tx("CHICKEN REPUBLIC IKEJA", "Chicken Republic", bank.Debit), "food"},
		{tx("MTN DATA BUNDLE", "MTN", bank.Debit), "airtime_data"},
		{tx("DSTV SUBSCRIPTION", "", bank.Debit), "bills"},
		{tx("POS SETTLEMENT", "Customer POS", bank.Credit), "income"},
		{tx("Transfer ref1", "Ada", bank.Debit), "transfer"},
		{tx("RANDOM THING", "Someone", bank.Debit), "other"},
	}
	for _, c := range cases {
		if got := ByRules(c.t); got != c.want {
			t.Errorf("%q: got %s want %s", c.t.Narration, got, c.want)
		}
	}
}

func TestOverrideWinsForThatMerchantOnly(t *testing.T) {
	s := &Service{Store: NewMemoryStore(), Now: time.Now}
	ctx := context.Background()
	bolt := tx("BOLT RIDE LAGOS", "Bolt", bank.Debit)
	uber := tx("UBER TRIP", "Uber", bank.Debit)
	if err := s.Set(ctx, "u1", " Bolt ", "shopping"); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Label(ctx, "u1", []bank.Transaction{bolt, uber})
	if got[0] != "shopping" || got[1] != "transport" {
		t.Fatalf("got %v", got)
	}
	other, _ := s.Label(ctx, "u2", []bank.Transaction{bolt})
	if other[0] != "transport" {
		t.Fatal("override leaked to another user")
	}
	if err := s.Set(ctx, "u1", "Bolt", "nonsense"); err != ErrBadCategory {
		t.Fatalf("got %v", err)
	}
}
