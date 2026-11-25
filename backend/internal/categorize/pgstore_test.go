package categorize

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/db"
)

func TestPostgresOverrides(t *testing.T) {
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
	d.Exec(`DELETE FROM user_limits; DELETE FROM shield_dismissals; DELETE FROM reports; DELETE FROM split_receive_legs; DELETE FROM split_receive_runs; DELETE FROM split_receive_rules; DELETE FROM merchant_overrides; DELETE FROM merchant_overrides; DELETE FROM sessions; DELETE FROM otp_codes; DELETE FROM audit_log; DELETE FROM linked_accounts; DELETE FROM transfer_legs; DELETE FROM transfers; DELETE FROM users`)
	d.Exec(`INSERT INTO users (id, phone) VALUES ('u1', '+2348000000003')`)
	s := &Service{Store: PGStore{DB: d}, Now: time.Now}
	if err := s.Set(ctx, "u1", "Bolt", "shopping"); err != nil {
		t.Fatal(err)
	}
	if err := s.Set(ctx, "u1", "bolt", "food"); err != nil { // same merchant updates in place
		t.Fatal(err)
	}
	ov, _ := s.Store.Overrides(ctx, "u1")
	if len(ov) != 1 || ov["bolt"] != "food" {
		t.Fatalf("overrides %v", ov)
	}
}
