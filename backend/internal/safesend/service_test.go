package safesend

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
)

var t0 = time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)

func svc() *Service {
	return &Service{Store: NewMemoryStore(), Salt: []byte("s"), Now: func() time.Time { return t0 },
		ResolveName: func(_ context.Context, b, a string) (string, bool) {
			if a == "1111111111" {
				return "Ada Okafor", true
			}
			return "", false
		}}
}

func has(v []string, x string) bool {
	for _, s := range v {
		if s == x {
			return true
		}
	}
	return false
}

func TestHighNeedsThreeIndependentReporters(t *testing.T) {
	s, ctx := svc(), context.Background()
	to := Recipient{BankCode: "apex", AccountNumber: "9000000001"}
	for i, r := range []string{"a", "b"} {
		if ok, err := s.Report(ctx, r, to, "ref-12345"); !ok || err != nil {
			t.Fatal(i, ok, err)
		}
	}
	// the same reporter again does not count twice
	if ok, _ := s.Report(ctx, "a", to, "ref-12345"); ok {
		t.Fatal("duplicate report counted")
	}
	res, _ := s.Check(ctx, "u", to, 1000, nil)
	if res.Tier == TierHigh {
		t.Fatal("two reporters should not be high")
	}
	s.Report(ctx, "c", to, "ref-12345")
	res, _ = s.Check(ctx, "u", to, 1000, nil)
	if res.Tier != TierHigh || !has(res.Flags, "reported_recipient") {
		t.Fatalf("%+v", res)
	}
}

func TestReportRules(t *testing.T) {
	s, ctx := svc(), context.Background()
	if _, err := s.Report(ctx, "a", Recipient{"apex", "1", ""}, "  "); !errors.Is(err, ErrEvidenceRequired) {
		t.Fatal("evidence not required")
	}
	for i := 0; i < MaxReportsPerDay; i++ {
		if _, err := s.Report(ctx, "a", Recipient{"apex", string(rune('0' + i)), ""}, "evidence-1"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Report(ctx, "a", Recipient{"apex", "99", ""}, "evidence-1"); !errors.Is(err, ErrReportLimit) {
		t.Fatalf("limit: %v", err)
	}
}

func TestLowUnknownAndSignals(t *testing.T) {
	s, ctx := svc(), context.Background()
	clean := Recipient{"apex", "1111111111", "Ada Okafor"}
	if r, _ := s.Check(ctx, "u", clean, 5000, nil); r.Tier != TierLow && !has(r.Flags, "new_beneficiary") {
		t.Fatalf("%+v", r)
	}
	// resolved name, but first time paying: stays unknown because of new beneficiary
	if r, _ := s.Check(ctx, "u", clean, 5000, nil); r.Tier != TierUnknown {
		t.Fatalf("new beneficiary must not be low: %+v", r)
	}
	hist := []Payment{{Recipient: clean, AmountKobo: 5000, At: t0.Add(-48 * time.Hour), Successful: true}}
	if r, _ := s.Check(ctx, "u", clean, 5000, hist); r.Tier != TierLow {
		t.Fatalf("known clean recipient should be low: %+v", r)
	}
	// name mismatch
	if r, _ := s.Check(ctx, "u", Recipient{"apex", "1111111111", "Bola Tinubu"}, 5000, hist); !has(r.Flags, "name_mismatch") || r.Tier == TierLow {
		t.Fatalf("%+v", r)
	}
	// unknown recipient
	if r, _ := s.Check(ctx, "u", Recipient{"apex", "2222222222", ""}, 5000, nil); r.Tier != TierUnknown {
		t.Fatalf("%+v", r)
	}
	// unusual amount
	h2 := []Payment{}
	for i := 0; i < 5; i++ {
		h2 = append(h2, Payment{Recipient: Recipient{"apex", "3", ""}, AmountKobo: 100000, At: t0.Add(-time.Duration(i+2) * time.Hour), Successful: true})
	}
	if r, _ := s.Check(ctx, "u", clean, 600000, h2); !has(r.Flags, "unusual_amount") {
		t.Fatalf("%+v", r)
	}
	// duplicate within 10 minutes
	h3 := []Payment{{Recipient: clean, AmountKobo: 5000, At: t0.Add(-3 * time.Minute), Successful: true}}
	if r, _ := s.Check(ctx, "u", clean, 5000, h3); !has(r.Flags, "possible_duplicate") {
		t.Fatalf("%+v", r)
	}
}

func TestShield(t *testing.T) {
	s, ctx := svc(), context.Background()
	credit := bank.Transaction{ID: "c1", AccountID: "a", Direction: bank.Credit, AmountKobo: 8_000_000, PostedAt: t0.Add(-20 * time.Hour), Counterparty: "Chuka"}
	if a, _ := s.Shield(ctx, "u", []bank.Transaction{credit}, 7_500_000); a == nil || a.CreditID != "c1" {
		t.Fatal("expected alert within 10 percent")
	}
	if a, _ := s.Shield(ctx, "u", []bank.Transaction{credit}, 5_000_000); a != nil {
		t.Fatal("far amount should not alert")
	}
	old := credit
	old.PostedAt = t0.Add(-30 * time.Hour)
	if a, _ := s.Shield(ctx, "u", []bank.Transaction{old}, 8_000_000); a != nil {
		t.Fatal("old credit should not alert")
	}
	verified := credit
	verified.Verified = true
	if a, _ := s.Shield(ctx, "u", []bank.Transaction{verified}, 8_000_000); a != nil {
		t.Fatal("verified credit should not alert")
	}
	s.Dismiss(ctx, "u", "c1")
	if a, _ := s.Shield(ctx, "u", []bank.Transaction{credit}, 8_000_000); a != nil {
		t.Fatal("dismissed alert came back")
	}
}

func TestShieldIgnoresApapoOwnMovementReferences(t *testing.T) {
	s, ctx := svc(), context.Background()
	for _, ref := range []string{"pay_pay-leg", "rev_transfer", "sr_leg", "p2p_payment"} {
		credit := bank.Transaction{
			ID: "own-" + ref, AccountID: "a", Direction: bank.Credit,
			AmountKobo: 8_000_000, PostedAt: t0.Add(-time.Hour),
			Counterparty: "Apapo movement", Reference: ref, Verified: false,
		}
		if alert, err := s.Shield(ctx, "u", []bank.Transaction{credit}, 8_000_000); err != nil || alert != nil {
			t.Fatalf("own movement %s alerted: %v %v", ref, err, alert)
		}
	}
}
