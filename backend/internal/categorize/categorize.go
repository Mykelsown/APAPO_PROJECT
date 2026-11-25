// Package categorize labels transactions with simple keyword rules, and lets a
// user override the label for one merchant.
package categorize

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
)

// Categories a transaction can have.
var Categories = []string{"transport", "food", "airtime_data", "bills", "shopping", "transfer", "income", "other"}

type rule struct {
	category string
	keywords []string
}

var rules = []rule{
	{"transport", []string{"BOLT", "UBER", "INDRIVE", "BRT", "FUEL", "PETROL", "TOTAL ENERGIES"}},
	{"food", []string{"CHICKEN", "RESTAURANT", "KFC", "DOMINO", "SHOPRITE", "BUKKA", "MR BIGGS", "EATERY"}},
	{"airtime_data", []string{"MTN", "AIRTEL", "GLO", "9MOBILE", "AIRTIME", "DATA BUNDLE"}},
	{"bills", []string{"DSTV", "GOTV", "IKEDC", "EKEDC", "ELECTRIC", "NEPA", "WATER", "STARTIMES"}},
	{"shopping", []string{"JUMIA", "KONGA", "MARKET", "STORE"}},
	{"transfer", []string{"TRANSFER", "TRF", "NIP"}},
}

// Key is how a merchant is remembered for overrides.
func Key(t bank.Transaction) string {
	k := strings.TrimSpace(t.Counterparty)
	if k == "" {
		k = t.Narration
	}
	return strings.ToLower(strings.TrimSpace(k))
}

// ByRules gives the default category with no user input.
func ByRules(t bank.Transaction) string {
	text := strings.ToUpper(t.Narration + " " + t.Counterparty)
	for _, r := range rules {
		for _, kw := range r.keywords {
			if strings.Contains(text, kw) {
				return r.category
			}
		}
	}
	if t.Direction == bank.Credit {
		return "income"
	}
	return "other"
}

func Valid(c string) bool {
	for _, x := range Categories {
		if x == c {
			return true
		}
	}
	return false
}

type Store interface {
	Overrides(ctx context.Context, userID string) (map[string]string, error)
	SetOverride(ctx context.Context, userID, merchantKey, category string, at time.Time) error
	DeleteOverride(ctx context.Context, userID, merchantKey string) error
}

var ErrBadCategory = errors.New("categorize: unknown category")

type Service struct {
	Store Store
	Now   func() time.Time
}

// Label returns each transaction's category, preferring the user's overrides.
func (s *Service) Label(ctx context.Context, userID string, txs []bank.Transaction) ([]string, error) {
	ov, err := s.Store.Overrides(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]string, len(txs))
	for i, t := range txs {
		if c, ok := ov[Key(t)]; ok {
			out[i] = c
		} else {
			out[i] = ByRules(t)
		}
	}
	return out, nil
}

func (s *Service) Set(ctx context.Context, userID, merchant, category string) error {
	if !Valid(category) {
		return ErrBadCategory
	}
	return s.Store.SetOverride(ctx, userID, strings.ToLower(strings.TrimSpace(merchant)), category, s.Now())
}

type MemoryStore struct {
	mu sync.Mutex
	m  map[string]map[string]string
}

func NewMemoryStore() *MemoryStore { return &MemoryStore{m: map[string]map[string]string{}} }

func (s *MemoryStore) Overrides(ctx context.Context, userID string) (map[string]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]string{}
	for k, v := range s.m[userID] {
		out[k] = v
	}
	return out, nil
}

func (s *MemoryStore) SetOverride(ctx context.Context, userID, key, category string, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.m[userID] == nil {
		s.m[userID] = map[string]string{}
	}
	s.m[userID][key] = category
	return nil
}

func (s *MemoryStore) DeleteOverride(ctx context.Context, userID, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m[userID], key)
	return nil
}

type PGStore struct{ DB *sql.DB }

func (s PGStore) Overrides(ctx context.Context, userID string) (map[string]string, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT merchant_key, category FROM merchant_overrides WHERE user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, c string
		if err := rows.Scan(&k, &c); err != nil {
			return nil, err
		}
		out[k] = c
	}
	return out, rows.Err()
}

func (s PGStore) SetOverride(ctx context.Context, userID, key, category string, at time.Time) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO merchant_overrides (user_id,merchant_key,category,updated_at) VALUES ($1,$2,$3,$4)
		ON CONFLICT (user_id,merchant_key) DO UPDATE SET category=$3, updated_at=$4`, userID, key, category, at)
	return err
}

func (s PGStore) DeleteOverride(ctx context.Context, userID, key string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM merchant_overrides WHERE user_id=$1 AND merchant_key=$2`, userID, key)
	return err
}
