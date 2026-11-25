package splitreceive

import (
	"context"
	"time"
)

// Entry is one place a slice of a credit went.
type Entry struct {
	Kind        string // "sent", "held" or "kept"
	Destination Destination
	AmountKobo  int64
	FeeKobo     int64
	State       LegState
	Error       string
}

// Credit is the settlement ledger for one incoming credit. Sent plus held plus kept
// always equals the credit.
type Credit struct {
	Run      *Run
	Entries  []Entry
	SentKobo int64
	HeldKobo int64 // shares that failed or are pending; still in the receiving account
	KeptKobo int64 // the remainder the rules leave in the receiving account
	Balanced bool
}

type Totals struct {
	Credits    int
	CreditKobo int64
	SentKobo   int64
	HeldKobo   int64
	KeptKobo   int64
	FeesKobo   int64
}

func ledgerFor(run *Run) Credit {
	c := Credit{Run: run}
	var legTotal int64
	for _, l := range run.Legs {
		legTotal += l.AmountKobo
		kind := "sent"
		if l.State != LegCollected {
			kind = "held"
			c.HeldKobo += l.AmountKobo
		} else {
			c.SentKobo += l.AmountKobo
		}
		c.Entries = append(c.Entries, Entry{Kind: kind, Destination: l.Dest, AmountKobo: l.AmountKobo, FeeKobo: l.FeeKobo, State: l.State, Error: l.Error})
	}
	c.KeptKobo = run.AmountKobo - legTotal
	if c.KeptKobo > 0 {
		c.Entries = append(c.Entries, Entry{Kind: "kept", AmountKobo: c.KeptKobo})
	}
	c.Balanced = c.SentKobo+c.HeldKobo+c.KeptKobo == run.AmountKobo && c.KeptKobo >= 0
	return c
}

// Reconciliation lists, newest first, where every naira of each credit in the period went.
func (s *Service) Reconciliation(ctx context.Context, userID string, from, to time.Time) ([]Credit, Totals, error) {
	runs, err := s.Store.ListRuns(ctx, userID, from, to, 0)
	if err != nil {
		return nil, Totals{}, err
	}
	var out []Credit
	var t Totals
	for _, r := range runs {
		c := ledgerFor(r)
		out = append(out, c)
		t.Credits++
		t.CreditKobo += r.AmountKobo
		t.SentKobo += c.SentKobo
		t.HeldKobo += c.HeldKobo
		t.KeptKobo += c.KeptKobo
		for _, e := range c.Entries {
			if e.Kind == "sent" {
				t.FeesKobo += e.FeeKobo
			}
		}
	}
	return out, t, nil
}
