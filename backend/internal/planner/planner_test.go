package planner

import (
	"errors"
	"testing"
)

func accs() []Account {
	return []Account{
		{ID: "a", BankCode: "apex", BalanceKobo: 7_000_000, FeeKobo: 1000},
		{ID: "b", BankCode: "delta", BalanceKobo: 6_000_000, FeeKobo: 500},
		{ID: "c", BankCode: "savanna", BalanceKobo: 4_500_000, FeeKobo: 1000},
		{ID: "d", BankCode: "harbor", BalanceKobo: 2_000_000, FeeKobo: 2500},
	}
}

func sum(p Plan) int64 {
	var s int64
	for _, l := range p.Legs {
		s += l.AmountKobo
	}
	return s
}

func TestPlanTable(t *testing.T) {
	tests := []struct {
		name     string
		amount   int64
		accounts []Account
		rules    Rules
		legs     int
		first    string
		fee      int64
	}{
		{"single account covers it", 1_000_000, accs(), Rules{}, 1, "a", 1000},
		{"three way split for 150000", 15_000_000, accs(), Rules{}, 3, "a", 2500},
		{"exact fit of one account after fee", 6_999_000, accs(), Rules{}, 1, "a", 1000},
		{"minimum balance leaves room out", 6_000_000, accs(), Rules{MinBalanceKobo: 2_000_000}, 2, "a", 1500},
		{"per account minimum", 6_500_000, accs(), Rules{MinBalanceByAccount: map[string]int64{"a": 6_900_000}}, 2, "b", 1500},
		{"lowest fee prefers cheapest single", 1_000_000, accs(), Rules{Strategy: LowestFee}, 1, "b", 500},
		{"lowest fee multi leg uses cheap banks first", 9_000_000, accs(), Rules{Strategy: LowestFee}, 2, "b", 1500},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p, err := Make(tc.amount, tc.accounts, tc.rules)
			if err != nil {
				t.Fatal(err)
			}
			if len(p.Legs) != tc.legs {
				t.Fatalf("legs %d want %d: %+v", len(p.Legs), tc.legs, p.Legs)
			}
			if p.Legs[0].AccountID != tc.first {
				t.Errorf("first leg %s want %s", p.Legs[0].AccountID, tc.first)
			}
			if p.TotalFeeKobo != tc.fee {
				t.Errorf("fee %d want %d", p.TotalFeeKobo, tc.fee)
			}
			if sum(p) != tc.amount {
				t.Errorf("legs sum %d want %d", sum(p), tc.amount)
			}
			if p.TotalDebitKobo != tc.amount+tc.fee {
				t.Errorf("total debit %d", p.TotalDebitKobo)
			}
		})
	}
}

func TestNeverOverdrawsAMinimum(t *testing.T) {
	rules := Rules{MinBalanceKobo: 1_000_000}
	p, err := Make(14_000_000, accs(), rules)
	if err != nil {
		t.Fatal(err)
	}
	bal := map[string]int64{}
	for _, a := range accs() {
		bal[a.ID] = a.BalanceKobo
	}
	for _, l := range p.Legs {
		if bal[l.AccountID]-l.AmountKobo-l.FeeKobo < rules.MinBalanceKobo {
			t.Fatalf("leg %+v breaks the minimum", l)
		}
	}
}

func TestInsufficientFunds(t *testing.T) {
	_, err := Make(25_000_000, accs(), Rules{})
	var ins *InsufficientFundsError
	if !errors.As(err, &ins) {
		t.Fatalf("got %v", err)
	}
	if ins.SpendableKobo != 19_495_000 {
		t.Fatalf("spendable %d", ins.SpendableKobo)
	}
	if ins.ShortfallKobo != 25_000_000-ins.SpendableKobo {
		t.Fatalf("shortfall %d", ins.ShortfallKobo)
	}
}

func TestTooManyLegs(t *testing.T) {
	if _, err := Make(15_000_000, accs(), Rules{MaxLegs: 2}); !errors.Is(err, ErrTooManyLegs) {
		t.Fatalf("got %v", err)
	}
}

func TestBadInput(t *testing.T) {
	if _, err := Make(0, accs(), Rules{}); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("got %v", err)
	}
	if _, err := Make(1, accs(), Rules{Strategy: "random"}); !errors.Is(err, ErrBadStrategy) {
		t.Fatalf("got %v", err)
	}
	if _, err := Make(1, nil, Rules{}); err == nil {
		t.Fatal("no accounts must fail")
	}
}

func TestLowestFeeFallsBackToFewerLegsUnderCap(t *testing.T) {
	list := []Account{
		{ID: "x", BalanceKobo: 1_100_000, FeeKobo: 100},
		{ID: "y", BalanceKobo: 1_100_000, FeeKobo: 100},
		{ID: "z", BalanceKobo: 1_100_000, FeeKobo: 200},
		{ID: "big", BalanceKobo: 5_100_000, FeeKobo: 1000},
	}
	p, err := Make(5_500_000, list, Rules{Strategy: LowestFee, MaxLegs: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Legs) != 2 || p.Legs[0].AccountID != "big" || sum(p) != 5_500_000 {
		t.Fatalf("got %+v", p.Legs)
	}
}
