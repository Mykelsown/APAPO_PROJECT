package links

import (
	"bytes"
	"os"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/audit"
	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
	"github.com/Mykelsown/apapo/backend/internal/db"
	"github.com/Mykelsown/apapo/backend/internal/secrets"
)

func TestPostgresLinkAndRevoke(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	d, err := db.Open(url)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := db.Migrate(ctx, d); err != nil {
		t.Fatal(err)
	}
	d.Exec(`DELETE FROM user_limits; DELETE FROM shield_dismissals; DELETE FROM reports; DELETE FROM split_receive_legs; DELETE FROM split_receive_runs; DELETE FROM split_receive_rules; DELETE FROM merchant_overrides; DELETE FROM sessions; DELETE FROM otp_codes; DELETE FROM audit_log; DELETE FROM linked_accounts; DELETE FROM transfer_legs; DELETE FROM transfers; DELETE FROM users`)
	d.Exec(`INSERT INTO users (id, phone) VALUES ('u1', '+2348000000002')`)
	box, _ := secrets.New(bytes.Repeat([]byte{1}, 32))
	p := mock.New(nil)
	s := &Service{Store: PGStore{DB: d}, Linker: p, Catalog: mock.Catalog(), Box: box, Audit: audit.PG{DB: d}, Now: time.Now}
	l, err := s.Link(ctx, "u1", "apex", []string{"accounts", "balances"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Link(ctx, "u1", "apex", []string{"accounts"}); err != ErrAlreadyLinked {
		t.Fatalf("double link: %v", err)
	}
	active, _ := s.Active(ctx, "u1")
	if len(active) != 1 || len(active[0].Scopes) != 2 {
		t.Fatalf("active %+v", active)
	}
	if tok, err := s.Token(active[0]); err != nil || tok == "" {
		t.Fatalf("token: %v", err)
	}
	if err := s.Revoke(ctx, "u1", l.ID); err != nil {
		t.Fatal(err)
	}
	var tokenIsNull bool
	d.QueryRow(`SELECT token_encrypted IS NULL FROM linked_accounts WHERE id=$1`, l.ID).Scan(&tokenIsNull)
	if !tokenIsNull {
		t.Fatal("token not wiped in the database")
	}
	entries, _ := audit.PG{DB: d}.List(ctx, "u1", 10, 0)
	if len(entries) != 2 || entries[0].Event != "bank.revoked" {
		t.Fatalf("audit %+v", entries)
	}
}
