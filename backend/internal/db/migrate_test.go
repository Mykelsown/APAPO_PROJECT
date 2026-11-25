package db

import (
	"context"
	"os"
	"testing"
)

// Runs only when TEST_DATABASE_URL points at an empty Postgres database.
func TestMigrateCreatesTablesAndIsRepeatable(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	d, err := Open(url)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	ctx := context.Background()
	for i := 0; i < 2; i++ { // second run must be a no-op
		if err := Migrate(ctx, d); err != nil {
			t.Fatal(err)
		}
	}
	for _, tbl := range []string{"users", "linked_accounts", "transfers", "transfer_legs", "reports", "audit_log"} {
		var n int
		if err := d.QueryRow(`SELECT count(*) FROM ` + tbl).Scan(&n); err != nil {
			t.Fatalf("table %s: %v", tbl, err)
		}
	}
}
