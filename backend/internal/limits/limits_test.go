package limits

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestAllowAndSet(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 11, 2, 23, 30, 0, 0, time.UTC) // 00:30 next day in Lagos
	spent := int64(0)
	var since time.Time
	s := &Service{Store: NewMemoryStore(), Now: func() time.Time { return now },
		Sources: []Spent{func(_ context.Context, _ string, at time.Time) (int64, error) { since = at; return spent, nil }}}
	if err := s.Allow(ctx, "u", DefaultDailyKobo); err != nil {
		t.Fatal(err)
	}
	if want := time.Date(2026, 11, 3, 0, 0, 0, 0, lagos); !since.Equal(want) {
		t.Fatalf("day start %v want %v", since, want)
	}
	if err := s.Set(ctx, "u", 500_000); err != nil {
		t.Fatal(err)
	}
	spent = 400_000
	err := s.Allow(ctx, "u", 100_001)
	var ex *ExceededError
	if !errors.As(err, &ex) || ex.RemainingKobo != 100_000 {
		t.Fatalf("%v", err)
	}
	if err := s.Allow(ctx, "u", 100_000); err != nil {
		t.Fatal("exact remaining should pass")
	}
	if !errors.Is(s.Set(ctx, "u", 10), ErrOutOfRange) || !errors.Is(s.Set(ctx, "u", MaxDailyKobo+1), ErrOutOfRange) {
		t.Fatal("range not enforced")
	}
}
