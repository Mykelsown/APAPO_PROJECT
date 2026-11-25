// Package audit records who did what and when: consent, links, payments, reports, logins.
package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"sync"
	"time"
)

type Entry struct {
	ID        int64          `json:"id"`
	UserID    string         `json:"user_id"`
	Event     string         `json:"event"`
	SubjectID string         `json:"subject_id"`
	Detail    map[string]any `json:"detail"`
	At        time.Time      `json:"at"`
}

type Logger interface {
	Log(ctx context.Context, e Entry) error
	// List returns a user's entries newest first. beforeID 0 means from the newest.
	List(ctx context.Context, userID string, limit int, beforeID int64) ([]Entry, error)
}

type Memory struct {
	mu      sync.Mutex
	entries []Entry
}

func NewMemory() *Memory { return &Memory{} }

func (m *Memory) Log(ctx context.Context, e Entry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e.ID = int64(len(m.entries) + 1)
	m.entries = append(m.entries, e)
	return nil
}

func (m *Memory) List(ctx context.Context, userID string, limit int, beforeID int64) ([]Entry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Entry
	for i := len(m.entries) - 1; i >= 0 && len(out) < limit; i-- {
		e := m.entries[i]
		if e.UserID == userID && (beforeID == 0 || e.ID < beforeID) {
			out = append(out, e)
		}
	}
	return out, nil
}

// All returns every entry (tests).
func (m *Memory) All() []Entry {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Entry(nil), m.entries...)
}

type PG struct{ DB *sql.DB }

func (p PG) Log(ctx context.Context, e Entry) error {
	d, _ := json.Marshal(e.Detail)
	_, err := p.DB.ExecContext(ctx, `INSERT INTO audit_log (user_id,event,subject_id,detail,at) VALUES (NULLIF($1,''),$2,$3,$4,$5)`,
		e.UserID, e.Event, e.SubjectID, d, e.At)
	return err
}

func (p PG) List(ctx context.Context, userID string, limit int, beforeID int64) ([]Entry, error) {
	q := `SELECT id, COALESCE(user_id,''), event, COALESCE(subject_id,''), detail, at FROM audit_log WHERE user_id=$1`
	args := []any{userID}
	if beforeID > 0 {
		q += ` AND id < $2`
		args = append(args, beforeID)
	}
	q += ` ORDER BY id DESC LIMIT ` + itoa(limit)
	rows, err := p.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Entry
	for rows.Next() {
		var e Entry
		var d []byte
		if err := rows.Scan(&e.ID, &e.UserID, &e.Event, &e.SubjectID, &d, &e.At); err != nil {
			return nil, err
		}
		json.Unmarshal(d, &e.Detail)
		out = append(out, e)
	}
	return out, rows.Err()
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}
