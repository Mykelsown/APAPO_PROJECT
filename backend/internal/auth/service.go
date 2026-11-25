package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"math/big"
	"regexp"
	"strings"
	"time"
)

const (
	OTPTTL          = 5 * time.Minute
	OTPMaxAttempts  = 5
	OTPMaxSends     = 3
	OTPSendWindow   = 10 * time.Minute
	AccessTTL       = 15 * time.Minute
	RefreshTTL      = 30 * 24 * time.Hour
	PINMaxFailures  = 5
	PINLockDuration = 15 * time.Minute
)

// IdentityVerifier checks a BVN. A BVN proves who someone is; it does not list their accounts.
type IdentityVerifier interface {
	Verify(ctx context.Context, bvn string) error
}

// MockVerifier accepts any 11 digits.
type MockVerifier struct{}

var bvnRe = regexp.MustCompile(`^\d{11}$`)

func (MockVerifier) Verify(ctx context.Context, bvn string) error {
	if !bvnRe.MatchString(bvn) {
		return ErrInvalidBVN
	}
	return nil
}

// OTPSender delivers a code. Production plugs in an SMS gateway.
type OTPSender interface {
	Send(ctx context.Context, phone, code string) error
}

type LogSender struct{}

func (LogSender) Send(ctx context.Context, phone, code string) error {
	log.Printf("OTP requested for %s (dev log sender)", phone)
	return nil
}

type Service struct {
	Store    Store
	Verifier IdentityVerifier
	Sender   OTPSender
	Now      func() time.Time
	// FixedOTP, when set, is used instead of a random code. Development only.
	FixedOTP string
	// Secret keys the hashes of codes and BVNs.
	Secret []byte
	// DemoPhone and DemoUserID map one phone to the mock bank's seeded user.
	DemoPhone   string
	DemoUserID  string
	DemoPhone2  string
	DemoUserID2 string
}

func New(s Store, secret []byte) *Service {
	return &Service{Store: s, Verifier: MockVerifier{}, Sender: LogSender{}, Now: time.Now, Secret: secret}
}

var phoneRe = regexp.MustCompile(`^\+234\d{10}$`)

// NormalizePhone turns 08012345678 or 2348012345678 into +2348012345678.
func NormalizePhone(p string) (string, error) {
	p = strings.NewReplacer(" ", "", "-", "").Replace(p)
	switch {
	case strings.HasPrefix(p, "0") && len(p) == 11:
		p = "+234" + p[1:]
	case strings.HasPrefix(p, "234"):
		p = "+" + p
	}
	if !phoneRe.MatchString(p) {
		return "", ErrInvalidPhone
	}
	return p, nil
}

func (s *Service) mac(parts ...string) string {
	h := hmac.New(sha256.New, s.Secret)
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func randomToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func newID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

func (s *Service) RequestOTP(ctx context.Context, rawPhone string) error {
	phone, err := NormalizePhone(rawPhone)
	if err != nil {
		return err
	}
	now := s.Now()
	o, found, err := s.Store.GetOTP(ctx, phone)
	if err != nil {
		return err
	}
	sent, window := 1, now
	if found && now.Sub(o.WindowStart) < OTPSendWindow {
		if o.SentCount >= OTPMaxSends {
			return ErrRateLimited
		}
		sent, window = o.SentCount+1, o.WindowStart
	}
	code := s.FixedOTP
	if code == "" {
		n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000))
		code = fmt.Sprintf("%06d", n.Int64())
	}
	if err := s.Store.PutOTP(ctx, OTP{Phone: phone, CodeHash: s.mac("otp", phone, code), ExpiresAt: now.Add(OTPTTL), SentCount: sent, WindowStart: window}); err != nil {
		return err
	}
	return s.Sender.Send(ctx, phone, code)
}

// VerifyOTP signs a person in, creating their account on first use.
func (s *Service) VerifyOTP(ctx context.Context, rawPhone, code string) (User, Tokens, error) {
	phone, err := NormalizePhone(rawPhone)
	if err != nil {
		return User{}, Tokens{}, err
	}
	now := s.Now()
	o, found, err := s.Store.GetOTP(ctx, phone)
	if err != nil {
		return User{}, Tokens{}, err
	}
	if !found {
		return User{}, Tokens{}, ErrInvalidOTP
	}
	if now.After(o.ExpiresAt) {
		s.Store.DeleteOTP(ctx, phone)
		return User{}, Tokens{}, ErrOTPExpired
	}
	if o.Attempts >= OTPMaxAttempts {
		return User{}, Tokens{}, ErrTooManyAttempts
	}
	if subtle.ConstantTimeCompare([]byte(o.CodeHash), []byte(s.mac("otp", phone, code))) != 1 {
		o.Attempts++
		s.Store.PutOTP(ctx, o)
		if o.Attempts >= OTPMaxAttempts {
			return User{}, Tokens{}, ErrTooManyAttempts
		}
		return User{}, Tokens{}, ErrInvalidOTP
	}
	s.Store.DeleteOTP(ctx, phone)
	id := newID("usr")
	if phone == s.DemoPhone && s.DemoUserID != "" {
		id = s.DemoUserID
	}
	if phone == s.DemoPhone2 && s.DemoUserID2 != "" {
		id = s.DemoUserID2
	}
	u, err := s.Store.UpsertUserByPhone(ctx, id, phone, now)
	if err != nil {
		return User{}, Tokens{}, err
	}
	t, err := s.issue(ctx, u.ID)
	return u, t, err
}

func (s *Service) issue(ctx context.Context, userID string) (Tokens, error) {
	now := s.Now()
	t := Tokens{AccessToken: randomToken(), RefreshToken: randomToken(), AccessExpiresAt: now.Add(AccessTTL), RefreshExpiresAt: now.Add(RefreshTTL)}
	err := s.Store.PutSession(ctx, Session{ID: newID("ses"), UserID: userID,
		AccessHash: hashToken(t.AccessToken), AccessExpires: t.AccessExpiresAt,
		RefreshHash: hashToken(t.RefreshToken), RefreshExpires: t.RefreshExpiresAt})
	return t, err
}

func (s *Service) VerifyBVN(ctx context.Context, userID, bvn string) error {
	if err := s.Verifier.Verify(ctx, bvn); err != nil {
		return err
	}
	u, err := s.Store.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	u.BVNHash = s.mac("bvn", bvn)
	return s.Store.UpdateUser(ctx, u)
}

func (s *Service) SetDisplayName(ctx context.Context, userID, displayName string) error {
	displayName = strings.TrimSpace(displayName)
	if displayName == "" || len([]rune(displayName)) > 80 {
		return ErrInvalidDisplayName
	}
	u, err := s.Store.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	u.DisplayName = displayName
	return s.Store.UpdateUser(ctx, u)
}

func (s *Service) SetReceivingAccount(ctx context.Context, userID, accountID string) error {
	u, err := s.Store.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	u.ReceivingAccountID = accountID
	return s.Store.UpdateUser(ctx, u)
}

var pinRe = regexp.MustCompile(`^\d{4,6}$`)

func (s *Service) SetPIN(ctx context.Context, userID, pin string) error {
	if !pinRe.MatchString(pin) {
		return ErrInvalidPIN
	}
	u, err := s.Store.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	if u.BVNHash == "" {
		return ErrBVNRequired
	}
	if u.PINHash != "" {
		return ErrPINAlreadySet
	}
	h, err := hashPIN(pin)
	if err != nil {
		return err
	}
	u.PINHash = h
	return s.Store.UpdateUser(ctx, u)
}

// CheckPIN verifies a user's PIN with lockout. Payments use it too (B8).
func (s *Service) CheckPIN(ctx context.Context, userID, pin string) error {
	u, err := s.Store.GetUser(ctx, userID)
	if err != nil {
		return ErrInvalidCredentials
	}
	now := s.Now()
	if u.PINLockedUntil != nil && now.Before(*u.PINLockedUntil) {
		return &LockedError{Until: *u.PINLockedUntil}
	}
	if u.PINHash == "" || !checkPINHash(u.PINHash, pin) {
		u.PINFailed++
		var lockErr error = ErrInvalidCredentials
		if u.PINFailed >= PINMaxFailures {
			until := now.Add(PINLockDuration)
			u.PINLockedUntil, u.PINFailed = &until, 0
			lockErr = &LockedError{Until: until}
		}
		s.Store.UpdateUser(ctx, u)
		return lockErr
	}
	changed := u.PINFailed != 0 || u.PINLockedUntil != nil
	u.PINFailed, u.PINLockedUntil = 0, nil
	// A correct PIN is the only moment the PIN is in hand, so old or weaker hashes
	// are upgraded here, silently. A failed upgrade leaves the old hash working.
	if pinNeedsRehash(u.PINHash) {
		if h, err := hashPIN(pin); err == nil {
			u.PINHash, changed = h, true
		}
	}
	if changed {
		s.Store.UpdateUser(ctx, u)
	}
	return nil
}

// Login is for returning users: phone and PIN.
func (s *Service) Login(ctx context.Context, rawPhone, pin string) (User, Tokens, error) {
	phone, err := NormalizePhone(rawPhone)
	if err != nil {
		return User{}, Tokens{}, ErrInvalidCredentials
	}
	u, err := s.Store.GetUserByPhone(ctx, phone)
	if err != nil {
		return User{}, Tokens{}, ErrInvalidCredentials
	}
	if err := s.CheckPIN(ctx, u.ID, pin); err != nil {
		return User{}, Tokens{}, err
	}
	t, err := s.issue(ctx, u.ID)
	return u, t, err
}

// Refresh swaps a refresh token for a fresh pair. The old pair stops working.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (Tokens, error) {
	sess, err := s.Store.GetSessionByRefreshHash(ctx, hashToken(refreshToken))
	if err != nil || sess.RevokedAt != nil || s.Now().After(sess.RefreshExpires) {
		return Tokens{}, ErrInvalidToken
	}
	now := s.Now()
	t := Tokens{AccessToken: randomToken(), RefreshToken: randomToken(), AccessExpiresAt: now.Add(AccessTTL), RefreshExpiresAt: now.Add(RefreshTTL)}
	sess.AccessHash, sess.AccessExpires = hashToken(t.AccessToken), t.AccessExpiresAt
	sess.RefreshHash, sess.RefreshExpires = hashToken(t.RefreshToken), t.RefreshExpiresAt
	return t, s.Store.PutSession(ctx, sess)
}

// Authenticate resolves an access token to its user and session.
func (s *Service) Authenticate(ctx context.Context, accessToken string) (User, Session, error) {
	sess, err := s.Store.GetSessionByAccessHash(ctx, hashToken(accessToken))
	if err != nil || sess.RevokedAt != nil || s.Now().After(sess.AccessExpires) {
		return User{}, Session{}, ErrInvalidToken
	}
	u, err := s.Store.GetUser(ctx, sess.UserID)
	if err != nil {
		return User{}, Session{}, ErrInvalidToken
	}
	return u, sess, nil
}

func (s *Service) Logout(ctx context.Context, sessionID string) error {
	return s.Store.RevokeSession(ctx, sessionID, s.Now())
}

// Sessions lists where the user is signed in.
func (s *Service) Sessions(ctx context.Context, userID string) ([]Session, error) {
	return s.Store.ListSessions(ctx, userID, s.Now())
}

// LogoutAll signs the user out everywhere.
func (s *Service) LogoutAll(ctx context.Context, userID string) error {
	return s.Store.RevokeUserSessions(ctx, userID, s.Now())
}
