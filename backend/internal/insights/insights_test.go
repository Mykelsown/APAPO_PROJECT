package insights

import (
	"fmt"
	"testing"
	"time"
)

var now = time.Date(2026, 11, 20, 12, 0, 0, 0, lagos)

func tx(id, cp, cat string, kobo int64, day time.Time) Tx {
	return Tx{ID: id, Counterparty: cp, AmountKobo: kobo, At: day, Category: cat, Debit: true}
}

func d(month time.Month, day int) time.Time { return time.Date(2026, month, day, 10, 0, 0, 0, lagos) }

func TestWindowsUseEqualDays(t *testing.T) {
	cur, prev := Windows(time.Date(2026, 3, 31, 12, 0, 0, 0, lagos)) // February has 28 days
	if !cur.From.Equal(time.Date(2026, 3, 1, 0, 0, 0, 0, lagos)) {
		t.Fatal(cur)
	}
	if !prev.To.Equal(time.Date(2026, 3, 1, 0, 0, 0, 0, lagos)) {
		t.Fatalf("previous window must stop at the end of last month: %v", prev)
	}
}

func TestShiftThresholdsAndDrivers(t *testing.T) {
	var txs []Tx
	for i := 0; i < 5; i++ { // transport: 5 x 6,000 = 30,000 last month, same days
		txs = append(txs, tx(fmt.Sprintf("p%d", i), "BOLT", "transport", 600_000, d(10, 2+i*3)))
	}
	for i := 0; i < 7; i++ { // 7 x 6,000 = 42,000 this month: +40 percent
		txs = append(txs, tx(fmt.Sprintf("c%d", i), "BOLT", "transport", 600_000, d(11, 1+i*2)))
	}
	// food: small change, below 20 percent
	for i := 0; i < 4; i++ {
		txs = append(txs, tx(fmt.Sprintf("fp%d", i), "Shop", "food", 1_000_000, d(10, 3+i)), tx(fmt.Sprintf("fc%d", i), "Shop", "food", 1_100_000, d(11, 2+i)))
	}
	// bills: big percent but under N5,000 absolute
	for i := 0; i < 3; i++ {
		txs = append(txs, tx(fmt.Sprintf("bp%d", i), "DSTV", "bills", 50_000, d(10, 4+i)), tx(fmt.Sprintf("bc%d", i), "DSTV", "bills", 120_000, d(11, 4+i)))
	}
	// shopping: only 2 transactions, too few
	txs = append(txs, tx("s1", "Mall", "shopping", 3_000_000, d(11, 5)), tx("s2", "Mall", "shopping", 3_000_000, d(11, 6)))
	// income and transfers are never spending shifts
	txs = append(txs, Tx{ID: "i1", Category: "income", AmountKobo: 99_000_000, At: d(11, 5), Debit: false})

	got := Shifts(txs, now)
	if len(got) != 1 || got[0].Category != "transport" {
		t.Fatalf("%+v", got)
	}
	s := got[0]
	if s.Direction != "up" || s.ChangePct != 40 || s.DeltaKobo != 1_200_000 {
		t.Fatalf("%+v", s)
	}
	if s.Current.Count != 7 || s.Previous.Count != 5 || s.TopPayees[0].Name != "BOLT" || len(s.SupportingIDs) != 5 || s.Summary == "" {
		t.Fatalf("drivers %+v", s)
	}
}

func TestDecreaseAndNewSpending(t *testing.T) {
	var txs []Tx
	for i := 0; i < 5; i++ {
		txs = append(txs, tx(fmt.Sprintf("p%d", i), "Chicken Rep", "food", 1_000_000, d(10, 2+i)))
	}
	txs = append(txs, tx("c1", "Chicken Rep", "food", 1_000_000, d(11, 2)))
	for i := 0; i < 3; i++ {
		txs = append(txs, tx(fmt.Sprintf("g%d", i), "Gym", "other", 400_000, d(11, 3+i)))
	}
	got := Shifts(txs, now)
	if len(got) != 2 {
		t.Fatalf("%+v", got)
	}
	if got[0].Category != "food" || got[0].Direction != "down" || got[0].ChangePct != 80 {
		t.Fatalf("%+v", got[0])
	}
	if got[1].Category != "other" || !got[1].New {
		t.Fatalf("%+v", got[1])
	}
}

func TestOutsideWindowsIgnored(t *testing.T) {
	// A transaction on the 25th of last month is beyond the equal-days window on the 20th.
	txs := []Tx{tx("a", "X", "food", 9_000_000, d(10, 25)), tx("b", "X", "food", 9_000_000, d(10, 26)), tx("c", "X", "food", 9_000_000, d(10, 27))}
	if got := Shifts(txs, now); len(got) != 0 {
		t.Fatalf("%+v", got)
	}
}
