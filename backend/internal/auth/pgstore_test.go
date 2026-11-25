package auth

import (
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/db"
)

// Runs the real flow against Postgres when TEST_DATABASE_URL is set.
func TestPostgresStoreFlow(t *testing.T) {
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

	r := newRig()
	r.svc.Store = PGStore{DB: d}
	u, tok := r.signUp(t)
	if err := r.svc.SetDisplayName(ctx, u.ID, "Ada One"); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.SetReceivingAccount(ctx, u.ID, "acc_apex_1"); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.VerifyBVN(ctx, u.ID, "22222222222"); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.SetPIN(ctx, u.ID, "4821"); err != nil {
		t.Fatal(err)
	}
	got, sess, err := r.svc.Authenticate(ctx, tok.AccessToken)
	if err != nil || !got.Onboarded() {
		t.Fatalf("authenticate: %v %+v", err, got)
	}
	if got.DisplayName != "Ada One" {
		t.Fatalf("display name not persisted: %q", got.DisplayName)
	}
	if got.ReceivingAccountID != "acc_apex_1" {
		t.Fatalf("receiving account not persisted: %q", got.ReceivingAccountID)
	}
	var locked *LockedError
	for i := 0; i < PINMaxFailures; i++ {
		err = r.svc.CheckPIN(ctx, u.ID, "0000")
	}
	if !errors.As(err, &locked) {
		t.Fatalf("lockout not persisted: %v", err)
	}
	r.now = r.now.Add(time.Hour)
	if err := r.svc.CheckPIN(ctx, u.ID, "4821"); err != nil {
		t.Fatal(err)
	}
	next, err := r.svc.Refresh(ctx, tok.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.svc.Refresh(ctx, tok.RefreshToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("old refresh token alive: %v", err)
	}
	r.svc.Logout(ctx, sess.ID)
	if _, _, err := r.svc.Authenticate(ctx, next.AccessToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("logout not persisted: %v", err)
	}
}
