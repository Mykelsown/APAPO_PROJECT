package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

var ctx = context.Background()

type captureSender struct{ last string }

func (c *captureSender) Send(_ context.Context, _, code string) error { c.last = code; return nil }

type rig struct {
	svc  *Service
	now  time.Time
	sent *captureSender
}

func newRig() *rig {
	PBKDF2Iterations = 1000
	PINArgon2 = Argon2Params{MemoryKiB: 64, Time: 1, Threads: 1}
	r := &rig{now: time.Date(2026, 11, 9, 9, 0, 0, 0, time.UTC), sent: &captureSender{}}
	r.svc = New(NewMemoryStore(), []byte("test-secret"))
	r.svc.Sender = r.sent
	r.svc.Now = func() time.Time { return r.now }
	return r
}

const phone = "08012345678"

func (r *rig) signUp(t *testing.T) (User, Tokens) {
	t.Helper()
	if err := r.svc.RequestOTP(ctx, phone); err != nil {
		t.Fatal(err)
	}
	u, tok, err := r.svc.VerifyOTP(ctx, phone, r.sent.last)
	if err != nil {
		t.Fatal(err)
	}
	return u, tok
}

func TestFullOnboardingFlow(t *testing.T) {
	r := newRig()
	u, tok := r.signUp(t)
	if u.Phone != "+2348012345678" || u.Onboarded() {
		t.Fatalf("user %+v", u)
	}
	if err := r.svc.SetPIN(ctx, u.ID, "4821"); !errors.Is(err, ErrBVNRequired) {
		t.Fatalf("PIN before BVN: %v", err)
	}
	if err := r.svc.VerifyBVN(ctx, u.ID, "22222222222"); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.SetPIN(ctx, u.ID, "4821"); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.SetPIN(ctx, u.ID, "1111"); !errors.Is(err, ErrPINAlreadySet) {
		t.Fatalf("second PIN: %v", err)
	}
	got, _, err := r.svc.Authenticate(ctx, tok.AccessToken)
	if err != nil || !got.Onboarded() {
		t.Fatalf("authenticate: %v %+v", err, got)
	}
	if got.BVNHash == "22222222222" || got.PINHash == "4821" {
		t.Fatal("secrets must be stored hashed")
	}
}

func TestBadInputs(t *testing.T) {
	r := newRig()
	if err := r.svc.RequestOTP(ctx, "12345"); !errors.Is(err, ErrInvalidPhone) {
		t.Fatalf("phone: %v", err)
	}
	u, _ := r.signUp(t)
	if err := r.svc.VerifyBVN(ctx, u.ID, "123"); !errors.Is(err, ErrInvalidBVN) {
		t.Fatalf("bvn: %v", err)
	}
	r.svc.VerifyBVN(ctx, u.ID, "22222222222")
	for _, pin := range []string{"123", "1234567", "12a4"} {
		if err := r.svc.SetPIN(ctx, u.ID, pin); !errors.Is(err, ErrInvalidPIN) {
			t.Fatalf("pin %q: %v", pin, err)
		}
	}
}

func TestWrongOTPAndAttemptLimit(t *testing.T) {
	r := newRig()
	r.svc.RequestOTP(ctx, phone)
	good := r.sent.last
	for i := 0; i < OTPMaxAttempts-1; i++ {
		if _, _, err := r.svc.VerifyOTP(ctx, phone, "000000"); !errors.Is(err, ErrInvalidOTP) {
			t.Fatalf("try %d: %v", i, err)
		}
	}
	if _, _, err := r.svc.VerifyOTP(ctx, phone, "000000"); !errors.Is(err, ErrTooManyAttempts) {
		t.Fatalf("limit: %v", err)
	}
	if _, _, err := r.svc.VerifyOTP(ctx, phone, good); !errors.Is(err, ErrTooManyAttempts) {
		t.Fatalf("even the right code is refused after the limit: %v", err)
	}
}

func TestOTPExpiresAndSendsAreRateLimited(t *testing.T) {
	r := newRig()
	r.svc.RequestOTP(ctx, phone)
	r.now = r.now.Add(OTPTTL + time.Second)
	if _, _, err := r.svc.VerifyOTP(ctx, phone, r.sent.last); !errors.Is(err, ErrOTPExpired) {
		t.Fatalf("expiry: %v", err)
	}
	r = newRig()
	for i := 0; i < OTPMaxSends; i++ {
		if err := r.svc.RequestOTP(ctx, phone); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.svc.RequestOTP(ctx, phone); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("rate limit: %v", err)
	}
	r.now = r.now.Add(OTPSendWindow + time.Second)
	if err := r.svc.RequestOTP(ctx, phone); err != nil {
		t.Fatalf("window should reset: %v", err)
	}
}

func TestPINLockout(t *testing.T) {
	r := newRig()
	u, _ := r.signUp(t)
	r.svc.VerifyBVN(ctx, u.ID, "22222222222")
	r.svc.SetPIN(ctx, u.ID, "4821")
	for i := 0; i < PINMaxFailures-1; i++ {
		if _, _, err := r.svc.Login(ctx, phone, "0000"); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("wrong pin %d: %v", i, err)
		}
	}
	_, _, err := r.svc.Login(ctx, phone, "0000")
	var locked *LockedError
	if !errors.As(err, &locked) {
		t.Fatalf("expected lockout: %v", err)
	}
	if _, _, err := r.svc.Login(ctx, phone, "4821"); !errors.Is(err, ErrLocked) {
		t.Fatalf("right PIN still locked out: %v", err)
	}
	r.now = locked.Until.Add(time.Second)
	if _, _, err := r.svc.Login(ctx, phone, "4821"); err != nil {
		t.Fatalf("unlock after the wait: %v", err)
	}
}

func TestSuccessResetsFailureCount(t *testing.T) {
	r := newRig()
	u, _ := r.signUp(t)
	r.svc.VerifyBVN(ctx, u.ID, "22222222222")
	r.svc.SetPIN(ctx, u.ID, "4821")
	for i := 0; i < PINMaxFailures-1; i++ {
		r.svc.CheckPIN(ctx, u.ID, "0000")
	}
	if err := r.svc.CheckPIN(ctx, u.ID, "4821"); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.CheckPIN(ctx, u.ID, "0000"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("counter should have reset, got %v", err)
	}
}

func TestRefreshRotatesAndOldTokensDie(t *testing.T) {
	r := newRig()
	_, tok := r.signUp(t)
	next, err := r.svc.Refresh(ctx, tok.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.svc.Refresh(ctx, tok.RefreshToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("old refresh token still works: %v", err)
	}
	if _, _, err := r.svc.Authenticate(ctx, tok.AccessToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("old access token still works: %v", err)
	}
	if _, _, err := r.svc.Authenticate(ctx, next.AccessToken); err != nil {
		t.Fatal(err)
	}
}

func TestAccessTokenExpiresAndLogoutRevokes(t *testing.T) {
	r := newRig()
	_, tok := r.signUp(t)
	_, sess, err := r.svc.Authenticate(ctx, tok.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	r.svc.Logout(ctx, sess.ID)
	if _, _, err := r.svc.Authenticate(ctx, tok.AccessToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("logout should revoke: %v", err)
	}
	if _, err := r.svc.Refresh(ctx, tok.RefreshToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("logout should revoke refresh: %v", err)
	}
	_, tok2 := r.signUp(t)
	r.now = r.now.Add(AccessTTL + time.Second)
	if _, _, err := r.svc.Authenticate(ctx, tok2.AccessToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("expired access token accepted: %v", err)
	}
}

func TestDemoPhoneGetsDemoUserID(t *testing.T) {
	r := newRig()
	r.svc.DemoPhone, r.svc.DemoUserID = "+2348012345678", "usr_demo"
	u, _ := r.signUp(t)
	if u.ID != "usr_demo" {
		t.Fatalf("id %s", u.ID)
	}
}
