//go:build integration

package real

import (
	"os"
	"testing"
)

// Run against the real sandbox with:
//
//	BANK_API_URL=... BANK_API_KEY=... BANK_TEST_USER=... go test -tags integration ./internal/bank/real
func TestSandboxAccountsAndBalance(t *testing.T) {
	p, err := New(Config{BaseURL: os.Getenv("BANK_API_URL"), APIKey: os.Getenv("BANK_API_KEY"), ReadRetries: 2})
	if err != nil {
		t.Skip("set BANK_API_URL and BANK_API_KEY")
	}
	accs, err := p.GetAccounts(ctx, os.Getenv("BANK_TEST_USER"))
	if err != nil {
		t.Fatal(err)
	}
	if len(accs) == 0 {
		t.Fatal("sandbox returned no accounts for the test user")
	}
	if _, err := p.GetBalance(ctx, accs[0].ID); err != nil {
		t.Fatal(err)
	}
}
