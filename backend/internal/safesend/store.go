package safesend

import (
	"context"
	"database/sql"
	"sync"
	"time"
)

// Store keeps scam reports (as salted hashes only) and Shield dismissals.
type Store interface {
	// AddReport records a report. created is false if this reporter already reported this recipient.
	AddReport(ctx context.Context, id, recipientHash, reporter, evidence string, at time.Time) (created bool, err error)
	Reporters(ctx context.Context, recipientHash string) (int, error)
	ReportsSince(ctx context.Context, reporter string, since time.Time) (int, error)
	Dismiss(ctx context.Context, userID, creditID string, at time.Time) error
	Dismissed(ctx context.Context, userID, creditID string) (bool, error)
}

type memReport struct {
	hash, reporter string
	at             time.Time
}

type MemoryStore struct {
	mu        sync.Mutex
	reports   []memReport
	dismissed map[string]bool
}

func NewMemoryStore() *MemoryStore { return &MemoryStore{dismissed: map[string]bool{}} }

func (m *MemoryStore) AddReport(ctx context.Context, id, hash, reporter, evidence string, at time.Time) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.reports {
		if r.hash == hash && r.reporter == reporter {
			return false, nil
		}
	}
	m.reports = append(m.reports, memReport{hash, reporter, at})
	return true, nil
}

func (m *MemoryStore) Reporters(ctx context.Context, hash string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, r := range m.reports {
		if r.hash == hash {
			n++
		}
	}
	return n, nil
}

func (m *MemoryStore) ReportsSince(ctx context.Context, reporter string, since time.Time) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, r := range m.reports {
		if r.reporter == reporter && !r.at.Before(since) {
			n++
		}
	}
	return n, nil
}

func (m *MemoryStore) Dismiss(ctx context.Context, userID, creditID string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.dismissed[userID+"|"+creditID] = true
	return nil
}

func (m *MemoryStore) Dismissed(ctx context.Context, userID, creditID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.dismissed[userID+"|"+creditID], nil
}

// PGStore is the Postgres version.
type PGStore struct{ DB *sql.DB }

func (s PGStore) AddReport(ctx context.Context, id, hash, reporter, evidence string, at time.Time) (bool, error) {
	res, err := s.DB.ExecContext(ctx, `INSERT INTO reports(id,recipient_hash,reporter_user_id,evidence_ref,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (recipient_hash,reporter_user_id) DO NOTHING`, id, hash, reporter, evidence, at)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

func (s PGStore) Reporters(ctx context.Context, hash string) (int, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(DISTINCT reporter_user_id) FROM reports WHERE recipient_hash=$1`, hash).Scan(&n)
	return n, err
}

func (s PGStore) ReportsSince(ctx context.Context, reporter string, since time.Time) (int, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM reports WHERE reporter_user_id=$1 AND created_at>=$2`, reporter, since).Scan(&n)
	return n, err
}

func (s PGStore) Dismiss(ctx context.Context, userID, creditID string, at time.Time) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO shield_dismissals(user_id,credit_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, userID, creditID, at)
	return err
}

func (s PGStore) Dismissed(ctx context.Context, userID, creditID string) (bool, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM shield_dismissals WHERE user_id=$1 AND credit_id=$2`, userID, creditID).Scan(&n)
	return n > 0, err
}
