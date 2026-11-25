// Package limits enforces a per user daily spending limit across Split-Pay and
// the money Split-Receive sends on.
package limits

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	DefaultDailyKobo int64 = 100_000_000   // N1,000,000
	MinDailyKobo     int64 = 100_000       // N1,000
	MaxDailyKobo     int64 = 1_000_000_000 // N10,000,000
)

// ExceededError says how much room is left today.
type ExceededError struct {
	LimitKobo, SpentKobo, RemainingKobo int64
}

func (e *ExceededError) Error() string {
	return fmt.Sprintf("daily limit exceeded: limit %d, spent %d", e.LimitKobo, e.SpentKobo)
}

var ErrOutOfRange = errors.New("limit out of range")

type Store interface {
	Get(ctx context.Context, userID string) (kobo int64, ok bool, err error)
	Set(ctx context.Context, userID string, kobo int64, at time.Time) error
}

type MemoryStore struct {
	mu sync.Mutex
	m  map[string]int64
}

func NewMemoryStore() *MemoryStore { return &MemoryStore{m: map[string]int64{}} }

func (s *MemoryStore) Get(ctx context.Context, u string) (int64, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[u]
	return v, ok, nil
}

func (s *MemoryStore) Set(ctx context.Context, u string, k int64, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[u] = k
	return nil
}

type PGStore struct{ DB *sql.DB }

func (s PGStore) Get(ctx context.Context, u string) (int64, bool, error) {
	var v int64
	err := s.DB.QueryRowContext(ctx, `SELECT daily_kobo FROM user_limits WHERE user_id=$1`, u).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	return v, err == nil, err
}

func (s PGStore) Set(ctx context.Context, u string, k int64, at time.Time) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO user_limits(user_id,daily_kobo,updated_at) VALUES($1,$2,$3)
		ON CONFLICT (user_id) DO UPDATE SET daily_kobo=EXCLUDED.daily_kobo, updated_at=EXCLUDED.updated_at`, u, k, at)
	return err
}

// Spent reports how much the user has sent since a given time.
type Spent func(ctx context.Context, userID string, since time.Time) (int64, error)

type Service struct {
	Store Store
	Now   func() time.Time
	// Sources of spending today: Split-Pay payments and Split-Receive sends.
	Sources []Spent
	// Locker makes Reserve atomic per user. Nil means an in-process lock, which is
	// right for one server without a database. Use a PGLocker with Postgres.
	Locker Locker

	once         sync.Once
	defaultLocks *MemoryLocker
}

var lagos = time.FixedZone("WAT", 3600)

// DayStart is midnight in Lagos, which has no daylight saving.
func (s *Service) DayStart() time.Time {
	n := s.now().In(lagos)
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, lagos)
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) Limit(ctx context.Context, userID string) (int64, error) {
	v, ok, err := s.Store.Get(ctx, userID)
	if err != nil {
		return 0, err
	}
	if !ok {
		return DefaultDailyKobo, nil
	}
	return v, nil
}

func (s *Service) SpentToday(ctx context.Context, userID string) (int64, error) {
	since := s.DayStart()
	var total int64
	for _, src := range s.Sources {
		v, err := src(ctx, userID, since)
		if err != nil {
			return 0, err
		}
		total += v
	}
	return total, nil
}

type Status struct{ LimitKobo, SpentKobo, RemainingKobo int64 }

func (s *Service) Status(ctx context.Context, userID string) (Status, error) {
	l, err := s.Limit(ctx, userID)
	if err != nil {
		return Status{}, err
	}
	sp, err := s.SpentToday(ctx, userID)
	if err != nil {
		return Status{}, err
	}
	rem := l - sp
	if rem < 0 {
		rem = 0
	}
	return Status{l, sp, rem}, nil
}

// Reserve checks that amountKobo fits under today's limit and, while still holding
// the user's lock, runs record. record must write the spend somewhere a Spent
// source will see it (a new payment row, a leg marked sent) before it returns, so
// the next caller for this user counts it. It fails with *ExceededError, and does
// not call record, when the amount does not fit. It satisfies splitreceive.Limiter.
func (s *Service) Reserve(ctx context.Context, userID string, amountKobo int64, record func(ctx context.Context) error) error {
	unlock, err := s.locker().Lock(ctx, userID)
	if err != nil {
		return err
	}
	defer unlock()
	if err := s.Allow(ctx, userID, amountKobo); err != nil {
		return err
	}
	return record(ctx)
}

func (s *Service) locker() Locker {
	if s.Locker != nil {
		return s.Locker
	}
	s.once.Do(func() { s.defaultLocks = NewMemoryLocker() })
	return s.defaultLocks
}

// Allow fails with *ExceededError when sending amountKobo would pass today's limit.
// On its own it is only a pre-check for previews: use Reserve when money will move.
func (s *Service) Allow(ctx context.Context, userID string, amountKobo int64) error {
	st, err := s.Status(ctx, userID)
	if err != nil {
		return err
	}
	if amountKobo > st.RemainingKobo {
		return &ExceededError{LimitKobo: st.LimitKobo, SpentKobo: st.SpentKobo, RemainingKobo: st.RemainingKobo}
	}
	return nil
}

func (s *Service) Set(ctx context.Context, userID string, kobo int64) error {
	if kobo < MinDailyKobo || kobo > MaxDailyKobo {
		return ErrOutOfRange
	}
	return s.Store.Set(ctx, userID, kobo, s.now())
}
