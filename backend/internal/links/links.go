// Package links manages which banks a user has connected, what they agreed to
// share, and revoking that. Provider tokens are stored encrypted.
package links

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"slices"
	"sync"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/audit"
	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/secrets"
)

const ConsentDays = 90

// Scopes a user can agree to share. Linking always needs "accounts".
var Scopes = []Scope{
	{"accounts", "Your account names and masked numbers"},
	{"balances", "Your account balances"},
	{"transactions", "Your transaction history"},
}

type Scope struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type Link struct {
	ID               string
	UserID           string
	BankCode         string
	ProviderRef      string
	TokenEnc         []byte
	Scopes           []string
	ConsentAt        time.Time
	ConsentExpiresAt time.Time
	RevokedAt        *time.Time
}

func (l Link) Active(now time.Time) bool {
	return l.RevokedAt == nil && now.Before(l.ConsentExpiresAt)
}

var (
	ErrNotFound      = errors.New("links: link not found")
	ErrAlreadyLinked = errors.New("links: bank already linked")
	ErrBadConsent    = errors.New("links: consent must include accounts and only known scopes")
)

type Store interface {
	Create(ctx context.Context, l Link) error
	ListForUser(ctx context.Context, userID string) ([]Link, error) // every link, including ended ones
	Get(ctx context.Context, userID, id string) (Link, error)
	// Revoke ends the link and wipes the stored token.
	Revoke(ctx context.Context, userID, id string, at time.Time) error
}

type Service struct {
	Store   Store
	Linker  bank.Linker
	Catalog []bank.BankInfo
	Box     *secrets.Box
	Audit   audit.Logger
	Now     func() time.Time
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "lnk_" + hex.EncodeToString(b)
}

func (s *Service) Link(ctx context.Context, userID, bankCode string, scopes []string) (Link, error) {
	supported := false
	for _, b := range s.Catalog {
		if b.Code == bankCode && b.Supported {
			supported = true
		}
	}
	if !supported {
		return Link{}, bank.ErrUnsupportedBank
	}
	if !validScopes(scopes) {
		return Link{}, ErrBadConsent
	}
	now := s.Now().UTC()
	existing, err := s.Active(ctx, userID)
	if err != nil {
		return Link{}, err
	}
	for _, l := range existing {
		if l.BankCode == bankCode {
			return Link{}, ErrAlreadyLinked
		}
	}
	res, err := s.Linker.LinkBank(ctx, userID, bankCode)
	if err != nil {
		return Link{}, err
	}
	l := Link{
		ID: newID(), UserID: userID, BankCode: bankCode, ProviderRef: res.ProviderRef,
		TokenEnc: s.Box.Encrypt([]byte(res.Token)), Scopes: slices.Clone(scopes),
		ConsentAt: now, ConsentExpiresAt: now.AddDate(0, 0, ConsentDays),
	}
	if err := s.Store.Create(ctx, l); err != nil {
		return Link{}, err
	}
	s.Audit.Log(ctx, audit.Entry{UserID: userID, Event: "bank.linked", SubjectID: l.ID, At: now,
		Detail: map[string]any{"bank": bankCode, "scopes": scopes, "expires_at": l.ConsentExpiresAt}})
	return l, nil
}

func validScopes(scopes []string) bool {
	if !slices.Contains(scopes, "accounts") {
		return false
	}
	for _, sc := range scopes {
		known := false
		for _, k := range Scopes {
			known = known || k.ID == sc
		}
		if !known {
			return false
		}
	}
	return true
}

// Active returns links that are neither revoked nor past their consent period.
func (s *Service) Active(ctx context.Context, userID string) ([]Link, error) {
	all, err := s.Store.ListForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := s.Now()
	var out []Link
	for _, l := range all {
		if l.Active(now) {
			out = append(out, l)
		}
	}
	return out, nil
}

func (s *Service) Revoke(ctx context.Context, userID, id string) error {
	l, err := s.Store.Get(ctx, userID, id)
	if err != nil {
		return err
	}
	if l.RevokedAt != nil {
		return nil // already ended
	}
	now := s.Now().UTC()
	if err := s.Store.Revoke(ctx, userID, id, now); err != nil {
		return err
	}
	s.Linker.Unlink(ctx, userID, l.BankCode)
	s.Audit.Log(ctx, audit.Entry{UserID: userID, Event: "bank.revoked", SubjectID: id, At: now, Detail: map[string]any{"bank": l.BankCode}})
	return nil
}

// Token decrypts a link's provider token for the real provider (B9).
func (s *Service) Token(l Link) (string, error) {
	b, err := s.Box.Decrypt(l.TokenEnc)
	return string(b), err
}

type MemoryStore struct {
	mu    sync.Mutex
	links map[string]Link
}

func NewMemoryStore() *MemoryStore { return &MemoryStore{links: map[string]Link{}} }

func (m *MemoryStore) Create(ctx context.Context, l Link) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.links[l.ID] = l
	return nil
}

func (m *MemoryStore) ListForUser(ctx context.Context, userID string) ([]Link, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Link
	for _, l := range m.links {
		if l.UserID == userID {
			out = append(out, l)
		}
	}
	slices.SortFunc(out, func(a, b Link) int { return a.ConsentAt.Compare(b.ConsentAt) })
	return out, nil
}

func (m *MemoryStore) Get(ctx context.Context, userID, id string) (Link, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	l, ok := m.links[id]
	if !ok || l.UserID != userID {
		return Link{}, ErrNotFound
	}
	return l, nil
}

func (m *MemoryStore) Revoke(ctx context.Context, userID, id string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	l, ok := m.links[id]
	if !ok || l.UserID != userID {
		return ErrNotFound
	}
	l.RevokedAt, l.TokenEnc = &at, nil
	m.links[id] = l
	return nil
}
