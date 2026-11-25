// Package auth handles phone OTP sign in, mock BVN, the transaction PIN, and
// sessions made of opaque tokens (only their hashes are stored).
package auth

import (
	"errors"
	"time"
)

type User struct {
	ID                 string
	Phone              string
	DisplayName        string
	ReceivingAccountID string
	BVNHash            string
	PINHash            string
	PINFailed          int
	PINLockedUntil     *time.Time
	CreatedAt          time.Time
}

func (u User) Onboarded() bool { return u.BVNHash != "" && u.PINHash != "" }

type OTP struct {
	Phone       string
	CodeHash    string
	ExpiresAt   time.Time
	Attempts    int
	SentCount   int
	WindowStart time.Time
}

type Session struct {
	ID             string
	UserID         string
	AccessHash     string
	AccessExpires  time.Time
	RefreshHash    string
	RefreshExpires time.Time
	RevokedAt      *time.Time
}

type Tokens struct {
	AccessToken      string    `json:"access_token"`
	RefreshToken     string    `json:"refresh_token"`
	AccessExpiresAt  time.Time `json:"access_expires_at"`
	RefreshExpiresAt time.Time `json:"refresh_expires_at"`
}

var (
	ErrInvalidPhone            = errors.New("auth: invalid phone number")
	ErrRateLimited             = errors.New("auth: too many codes requested")
	ErrInvalidOTP              = errors.New("auth: wrong or missing code")
	ErrOTPExpired              = errors.New("auth: code expired")
	ErrTooManyAttempts         = errors.New("auth: too many wrong codes")
	ErrInvalidBVN              = errors.New("auth: BVN must be 11 digits")
	ErrBVNRequired             = errors.New("auth: verify your BVN first")
	ErrInvalidPIN              = errors.New("auth: PIN must be 4 to 6 digits")
	ErrPINAlreadySet           = errors.New("auth: PIN is already set")
	ErrInvalidCredentials      = errors.New("auth: wrong phone or PIN")
	ErrLocked                  = errors.New("auth: too many wrong PINs, try again later")
	ErrInvalidToken            = errors.New("auth: invalid or expired token")
	ErrUserNotFound            = errors.New("auth: user not found")
	ErrInvalidDisplayName      = errors.New("auth: display name must be 1 to 80 characters")
	ErrInvalidReceivingAccount = errors.New("auth: invalid receiving account")
)

// LockedError tells the caller when the PIN unlocks again.
type LockedError struct{ Until time.Time }

func (e *LockedError) Error() string   { return ErrLocked.Error() }
func (e *LockedError) Is(t error) bool { return t == ErrLocked }
