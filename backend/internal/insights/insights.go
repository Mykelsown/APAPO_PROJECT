// Package insights finds meaningful changes in spending: this month so far against
// the same days of last month, per category, with the facts behind each change.
package insights

import (
	"fmt"
	"math"
	"sort"
	"time"
)

const (
	MinChangePct   = 20.0
	MinDeltaKobo   = 500_000 // N5,000
	MinTransaction = 3
)

var lagos = time.FixedZone("WAT", 3600)

// Tx is one spending or income entry with its category already decided.
type Tx struct {
	ID           string
	Counterparty string
	AmountKobo   int64
	At           time.Time
	Category     string
	Debit        bool
}

type Window struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

type Counterparty struct {
	Name       string `json:"name"`
	AmountKobo int64  `json:"amount_kobo"`
	Count      int    `json:"count"`
}

type Period struct {
	TotalKobo    int64 `json:"total_kobo"`
	Count        int   `json:"count"`
	AverageKobo  int64 `json:"average_kobo"`
	WeekendShare int   `json:"weekend_share_pct"`
}

type Shift struct {
	Category      string         `json:"category"`
	Direction     string         `json:"direction"` // up or down
	ChangePct     int            `json:"change_pct"`
	New           bool           `json:"new_spending"`
	DeltaKobo     int64          `json:"delta_kobo"`
	Current       Period         `json:"current"`
	Previous      Period         `json:"previous"`
	CurrentWindow Window         `json:"current_window"`
	PrevWindow    Window         `json:"previous_window"`
	TopPayees     []Counterparty `json:"top_counterparties"`
	SupportingIDs []string       `json:"supporting_transaction_ids"`
	Summary       string         `json:"summary"`
}

// Windows returns this month so far and the same stretch of last month. If last month
// is shorter, its window ends at its last day.
func Windows(now time.Time) (cur, prev Window) {
	n := now.In(lagos)
	startCur := time.Date(n.Year(), n.Month(), 1, 0, 0, 0, 0, lagos)
	startPrev := startCur.AddDate(0, -1, 0)
	elapsed := n.Sub(startCur)
	endPrev := startPrev.Add(elapsed)
	if endPrev.After(startCur) {
		endPrev = startCur
	}
	return Window{startCur, n}, Window{startPrev, endPrev}
}

func in(t time.Time, w Window) bool {
	return !t.Before(w.From) && t.Before(w.To) || t.Equal(w.To) && w.To.After(w.From)
}

func period(txs []Tx) Period {
	var p Period
	weekend := 0
	for _, t := range txs {
		p.TotalKobo += t.AmountKobo
		p.Count++
		if d := t.At.In(lagos).Weekday(); d == time.Saturday || d == time.Sunday {
			weekend++
		}
	}
	if p.Count > 0 {
		p.AverageKobo = p.TotalKobo / int64(p.Count)
		p.WeekendShare = int(math.Round(float64(weekend) * 100 / float64(p.Count)))
	}
	return p
}

func naira(k int64) string {
	n := k / 100
	s := fmt.Sprint(n)
	out := ""
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out += ","
		}
		out += string(c)
	}
	return "N" + out
}

var skip = map[string]bool{"income": true, "transfer": true}

// Shifts compares spending categories and returns the ones that moved enough to matter:
// at least 20 percent, at least N5,000, and at least 3 transactions in one of the periods.
// The biggest change in naira comes first.
func Shifts(txs []Tx, now time.Time) []Shift {
	curW, prevW := Windows(now)
	curBy, prevBy := map[string][]Tx{}, map[string][]Tx{}
	for _, t := range txs {
		if !t.Debit || skip[t.Category] {
			continue
		}
		switch {
		case in(t.At, curW):
			curBy[t.Category] = append(curBy[t.Category], t)
		case in(t.At, prevW):
			prevBy[t.Category] = append(prevBy[t.Category], t)
		}
	}
	cats := map[string]bool{}
	for c := range curBy {
		cats[c] = true
	}
	for c := range prevBy {
		cats[c] = true
	}
	var out []Shift
	for c := range cats {
		cp, pp := period(curBy[c]), period(prevBy[c])
		delta := cp.TotalKobo - pp.TotalKobo
		abs := delta
		if abs < 0 {
			abs = -abs
		}
		if abs < MinDeltaKobo || (cp.Count < MinTransaction && pp.Count < MinTransaction) {
			continue
		}
		s := Shift{Category: c, DeltaKobo: delta, Current: cp, Previous: pp, CurrentWindow: curW, PrevWindow: prevW}
		if pp.TotalKobo == 0 {
			s.New, s.ChangePct = true, 100
		} else {
			pct := float64(abs) * 100 / float64(pp.TotalKobo)
			if pct < MinChangePct {
				continue
			}
			s.ChangePct = int(math.Round(pct))
		}
		focus := curBy[c]
		s.Direction = "up"
		if delta < 0 {
			s.Direction, focus = "down", prevBy[c]
		}
		s.TopPayees, s.SupportingIDs = drivers(focus)
		s.Summary = summary(s)
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i].DeltaKobo, out[j].DeltaKobo
		if a < 0 {
			a = -a
		}
		if b < 0 {
			b = -b
		}
		if a != b {
			return a > b
		}
		return out[i].Category < out[j].Category
	})
	return out
}

func drivers(txs []Tx) ([]Counterparty, []string) {
	by := map[string]*Counterparty{}
	for _, t := range txs {
		c := by[t.Counterparty]
		if c == nil {
			c = &Counterparty{Name: t.Counterparty}
			by[t.Counterparty] = c
		}
		c.AmountKobo += t.AmountKobo
		c.Count++
	}
	var top []Counterparty
	for _, c := range by {
		top = append(top, *c)
	}
	sort.Slice(top, func(i, j int) bool {
		if top[i].AmountKobo != top[j].AmountKobo {
			return top[i].AmountKobo > top[j].AmountKobo
		}
		return top[i].Name < top[j].Name
	})
	if len(top) > 3 {
		top = top[:3]
	}
	sorted := append([]Tx(nil), txs...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].AmountKobo != sorted[j].AmountKobo {
			return sorted[i].AmountKobo > sorted[j].AmountKobo
		}
		return sorted[i].ID < sorted[j].ID
	})
	var ids []string
	for i := 0; i < len(sorted) && i < 5; i++ {
		ids = append(ids, sorted[i].ID)
	}
	return top, ids
}

func summary(s Shift) string {
	word := "up"
	if s.Direction == "down" {
		word = "down"
	}
	lead := fmt.Sprintf("%s spending is %s %d%% (%s so far, against %s over the same days last month).",
		title(s.Category), word, s.ChangePct, naira(s.Current.TotalKobo), naira(s.Previous.TotalKobo))
	if s.New {
		lead = fmt.Sprintf("%s spending is new this month: %s so far, nothing over the same days last month.", title(s.Category), naira(s.Current.TotalKobo))
	}
	cause := fmt.Sprintf(" Transactions went from %d to %d, average %s to %s.", s.Previous.Count, s.Current.Count, naira(s.Previous.AverageKobo), naira(s.Current.AverageKobo))
	if len(s.TopPayees) > 0 && s.TopPayees[0].Name != "" {
		cause += " Biggest: " + s.TopPayees[0].Name + "."
	}
	return lead + cause
}

func title(c string) string {
	if c == "" {
		return c
	}
	b := []byte(c)
	if b[0] >= 'a' && b[0] <= 'z' {
		b[0] -= 32
	}
	return string(b)
}
