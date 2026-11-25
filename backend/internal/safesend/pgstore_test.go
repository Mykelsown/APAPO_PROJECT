package safesend

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/db"
)

func TestPostgresStore(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	d, err := db.Open(url)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	ctx := context.Background()
	if err := db.Migrate(ctx, d); err != nil {
		t.Fatal(err)
	}
	d.Exec(`DELETE FROM user_limits; DELETE FROM shield_dismissals; DELETE FROM reports; DELETE FROM split_receive_legs; DELETE FROM split_receive_runs; DELETE FROM split_receive_rules; DELETE FROM merchant_overrides; DELETE FROM reports; DELETE FROM shield_dismissals`)
	s := &Service{Store: PGStore{DB: d}, Salt: []byte("s"), Now: time.Now}
	to := Recipient{BankCode: "apex", AccountNumber: "9000000001"}
	for _, r := range []string{"x", "y", "z"} {
		if ok, err := s.Report(ctx, r, to, "evidence-1"); !ok || err != nil {
			t.Fatal(ok, err)
		}
	}
	if ok, _ := s.Report(ctx, "x", to, "evidence-1"); ok {
		t.Fatal("duplicate stored")
	}
	if res, _ := s.Check(ctx, "u", to, 100, nil); res.Tier != TierHigh {
		t.Fatalf("%+v", res)
	}
	s.Dismiss(ctx, "u", "c1")
	if d, _ := s.Store.Dismissed(ctx, "u", "c1"); !d {
		t.Fatal("dismissal lost")
	}
	var n int
	d.QueryRow(`SELECT COUNT(*) FROM reports WHERE recipient_hash LIKE '%9000000001%'`).Scan(&n)
	if n != 0 {
		t.Fatal("raw account number stored")
	}
}
