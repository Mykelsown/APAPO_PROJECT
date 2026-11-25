package auth

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha512"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"testing"
)

// hashPINPBKDF2 makes a hash in the format used before argon2id.
func hashPINPBKDF2(t *testing.T, pin string) string {
	t.Helper()
	salt := make([]byte, 16)
	rand.Read(salt)
	k, err := pbkdf2.Key(sha512.New, pin, salt, PBKDF2Iterations, 32)
	if err != nil {
		t.Fatal(err)
	}
	return fmt.Sprintf("pbkdf2$%d$%s$%s", PBKDF2Iterations, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(k))
}

// onboardedWithHash signs a user up, finishes onboarding and swaps in the given PIN hash.
func (r *rig) onboardedWithHash(t *testing.T, hash string) User {
	t.Helper()
	u, _ := r.signUp(t)
	if err := r.svc.VerifyBVN(ctx, u.ID, "22222222222"); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.SetPIN(ctx, u.ID, "4821"); err != nil {
		t.Fatal(err)
	}
	u, _ = r.svc.Store.GetUser(ctx, u.ID)
	if hash != "" {
		u.PINHash = hash
		r.svc.Store.UpdateUser(ctx, u)
	}
	return u
}

func (r *rig) storedHash(t *testing.T, id string) string {
	u, err := r.svc.Store.GetUser(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return u.PINHash
}

func TestNewPINHashIsArgon2idAndVerifies(t *testing.T) {
	r := newRig()
	u := r.onboardedWithHash(t, "")
	h := r.storedHash(t, u.ID)
	if !strings.HasPrefix(h, "argon2id$v=19$m=64,t=1,p=1$") || strings.Count(h, "$") != 4 {
		t.Fatalf("hash format %q", h)
	}
	if err := r.svc.CheckPIN(ctx, u.ID, "4821"); err != nil {
		t.Fatal(err)
	}
	if r.storedHash(t, u.ID) != h {
		t.Fatal("a current hash must not be rewritten")
	}
	// Two hashes of the same PIN differ (random salt).
	h2, _ := hashPIN("4821")
	if h2 == h {
		t.Fatal("salt not random")
	}
}

func TestWrongPINFailsForBothFormats(t *testing.T) {
	r := newRig()
	u := r.onboardedWithHash(t, "")
	if err := r.svc.CheckPIN(ctx, u.ID, "4822"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("argon2id wrong PIN: %v", err)
	}
	old := hashPINPBKDF2(t, "4821")
	u.PINHash = old
	r.svc.Store.UpdateUser(ctx, u)
	if err := r.svc.CheckPIN(ctx, u.ID, "0000"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("pbkdf2 wrong PIN: %v", err)
	}
	if r.storedHash(t, u.ID) != old {
		t.Fatal("a wrong PIN must never upgrade the hash")
	}
}

func TestOldPBKDF2HashVerifiesAndIsUpgraded(t *testing.T) {
	r := newRig()
	u := r.onboardedWithHash(t, hashPINPBKDF2(t, "4821"))
	if err := r.svc.CheckPIN(ctx, u.ID, "4821"); err != nil {
		t.Fatalf("old hash should still verify: %v", err)
	}
	h := r.storedHash(t, u.ID)
	if !strings.HasPrefix(h, "argon2id$") {
		t.Fatalf("not upgraded: %q", h)
	}
	if err := r.svc.CheckPIN(ctx, u.ID, "4821"); err != nil {
		t.Fatalf("upgraded hash should verify: %v", err)
	}
}

func TestLoginUpgradesOldHash(t *testing.T) {
	r := newRig()
	u := r.onboardedWithHash(t, hashPINPBKDF2(t, "4821"))
	if _, _, err := r.svc.Login(ctx, phone, "4821"); err != nil {
		t.Fatal(err)
	}
	if h := r.storedHash(t, u.ID); !strings.HasPrefix(h, "argon2id$") {
		t.Fatalf("login did not upgrade: %q", h)
	}
}

func TestRaisedCostRehashesOnNextCorrectPIN(t *testing.T) {
	r := newRig()
	u := r.onboardedWithHash(t, "")
	before := PINArgon2
	defer func() { PINArgon2 = before }()
	PINArgon2 = Argon2Params{MemoryKiB: 128, Time: 2, Threads: 1}
	if err := r.svc.CheckPIN(ctx, u.ID, "4821"); err != nil {
		t.Fatal(err)
	}
	if h := r.storedHash(t, u.ID); !strings.Contains(h, "$m=128,t=2,p=1$") {
		t.Fatalf("not rehashed at the new cost: %q", h)
	}
}

func TestLockoutUnchangedWithOldHash(t *testing.T) {
	r := newRig()
	old := hashPINPBKDF2(t, "4821")
	u := r.onboardedWithHash(t, old)
	var err error
	for i := 0; i < PINMaxFailures; i++ {
		err = r.svc.CheckPIN(ctx, u.ID, "1111")
	}
	var locked *LockedError
	if !errors.As(err, &locked) {
		t.Fatalf("expected lockout after %d tries, got %v", PINMaxFailures, err)
	}
	// Even the right PIN is refused while locked, and nothing is upgraded.
	if err := r.svc.CheckPIN(ctx, u.ID, "4821"); !errors.Is(err, ErrLocked) {
		t.Fatalf("correct PIN while locked: %v", err)
	}
	if r.storedHash(t, u.ID) != old {
		t.Fatal("hash changed while locked")
	}
	r.now = locked.Until.Add(1)
	if err := r.svc.CheckPIN(ctx, u.ID, "4821"); err != nil {
		t.Fatalf("after lock ends: %v", err)
	}
	if !strings.HasPrefix(r.storedHash(t, u.ID), "argon2id$") {
		t.Fatal("not upgraded after the lock ended")
	}
}

func TestCorruptHashesAreRejected(t *testing.T) {
	for _, h := range []string{
		"", "plain", "argon2id$v=19$m=64,t=1,p=1$c2FsdHNhbHQ", "argon2id$v=18$m=64,t=1,p=1$c2FsdHNhbHRzYWx0$a2V5a2V5a2V5a2V5a2V5",
		"argon2id$v=19$m=99999999,t=1,p=1$c2FsdHNhbHRzYWx0$a2V5a2V5a2V5a2V5a2V5", "argon2id$v=19$m=64,t=0,p=1$c2FsdHNhbHRzYWx0$a2V5a2V5a2V5a2V5a2V5",
		"argon2id$v=19$x=64,t=1,p=1$c2FsdHNhbHRzYWx0$a2V5a2V5a2V5a2V5a2V5", "pbkdf2$abc$c2FsdA$a2V5", "pbkdf2$0$c2FsdA$a2V5",
	} {
		if checkPINHash(h, "4821") {
			t.Fatalf("accepted %q", h)
		}
	}
}
