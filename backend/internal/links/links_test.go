package links

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/audit"
	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
	"github.com/Mykelsown/apapo/backend/internal/secrets"
)

var ctx = context.Background()

func newSvc() (*Service, *mock.Provider, *audit.Memory, *time.Time) {
	p := mock.New(nil)
	box, _ := secrets.New(bytes.Repeat([]byte{1}, 32))
	a := audit.NewMemory()
	now := time.Date(2026, 11, 9, 9, 0, 0, 0, time.UTC)
	return &Service{Store: NewMemoryStore(), Linker: p, Catalog: mock.Catalog(), Box: box, Audit: a, Now: func() time.Time { return now }}, p, a, &now
}

func TestLinkTwoBanksAndListAccounts(t *testing.T) {
	s, p, _, _ := newSvc()
	for _, code := range []string{"apex", "delta"} {
		if _, err := s.Link(ctx, "u1", code, []string{"accounts", "balances"}); err != nil {
			t.Fatal(err)
		}
	}
	active, _ := s.Active(ctx, "u1")
	if len(active) != 2 {
		t.Fatalf("active %d", len(active))
	}
	accs, _ := p.AccountsAt(ctx, "u1", "apex")
	if len(accs) != 1 || accs[0].BalanceKobo != 7_000_000 {
		t.Fatalf("accounts %+v", accs)
	}
}

func TestTokenIsEncryptedAtRest(t *testing.T) {
	s, _, _, _ := newSvc()
	l, _ := s.Link(ctx, "u1", "apex", []string{"accounts"})
	stored, _ := s.Store.Get(ctx, "u1", l.ID)
	if bytes.Contains(stored.TokenEnc, []byte("mocktok")) {
		t.Fatal("token stored in the clear")
	}
	tok, err := s.Token(stored)
	if err != nil || tok == "" {
		t.Fatalf("decrypt: %v %q", err, tok)
	}
}

func TestLinkRules(t *testing.T) {
	s, p, _, _ := newSvc()
	if _, err := s.Link(ctx, "u1", "lagoon", []string{"accounts"}); !errors.Is(err, bank.ErrUnsupportedBank) {
		t.Errorf("coming soon bank: %v", err)
	}
	if _, err := s.Link(ctx, "u1", "nope", []string{"accounts"}); !errors.Is(err, bank.ErrUnsupportedBank) {
		t.Errorf("unknown bank: %v", err)
	}
	for _, sc := range [][]string{nil, {"balances"}, {"accounts", "everything"}} {
		if _, err := s.Link(ctx, "u1", "apex", sc); !errors.Is(err, ErrBadConsent) {
			t.Errorf("scopes %v: %v", sc, err)
		}
	}
	s.Link(ctx, "u1", "apex", []string{"accounts"})
	if _, err := s.Link(ctx, "u1", "apex", []string{"accounts"}); !errors.Is(err, ErrAlreadyLinked) {
		t.Errorf("double link: %v", err)
	}
	p.SetBankFailure("delta", mock.FailBankDown)
	if _, err := s.Link(ctx, "u1", "delta", []string{"accounts"}); !errors.Is(err, bank.ErrBankUnavailable) {
		t.Errorf("bank down: %v", err)
	}
}

func TestRevokeWipesTokenEndsConsentAndAllowsRelink(t *testing.T) {
	s, _, a, _ := newSvc()
	l, _ := s.Link(ctx, "u1", "apex", []string{"accounts"})
	if err := s.Revoke(ctx, "u1", l.ID); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.Store.Get(ctx, "u1", l.ID)
	if stored.RevokedAt == nil || stored.TokenEnc != nil {
		t.Fatalf("not wiped: %+v", stored)
	}
	if active, _ := s.Active(ctx, "u1"); len(active) != 0 {
		t.Fatal("revoked link still active")
	}
	if _, err := s.Link(ctx, "u1", "apex", []string{"accounts"}); err != nil {
		t.Fatalf("relink: %v", err)
	}
	events := map[string]int{}
	for _, e := range a.All() {
		events[e.Event]++
	}
	if events["bank.linked"] != 2 || events["bank.revoked"] != 1 {
		t.Fatalf("audit %v", events)
	}
	if err := s.Revoke(ctx, "someone_else", l.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user revoke: %v", err)
	}
}

func TestConsentExpires(t *testing.T) {
	s, _, _, now := newSvc()
	s.Link(ctx, "u1", "apex", []string{"accounts"})
	*now = now.AddDate(0, 0, ConsentDays+1)
	if active, _ := s.Active(ctx, "u1"); len(active) != 0 {
		t.Fatal("expired consent still active")
	}
}
