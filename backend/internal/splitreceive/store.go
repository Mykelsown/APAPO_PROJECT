package splitreceive

import (
	"context"
	"sort"
	"sync"
	"time"
)

type Store interface {
	GetRules(ctx context.Context, userID string) (Rules, bool, error)
	PutRules(ctx context.Context, r Rules) error
	// ActiveUsers lists users who currently have active rules (for the background scan).
	ActiveUsers(ctx context.Context) ([]string, error)

	// CreateRun saves a new run. If this user already has a run for the credit it
	// returns that run and created=false: one run per credit, always.
	CreateRun(ctx context.Context, r *Run) (existing *Run, created bool, err error)
	GetRun(ctx context.Context, userID, id string) (*Run, error)
	UpdateRun(ctx context.Context, r *Run) error
	// ListRuns returns newest first. from and to are zero for no bound.
	ListRuns(ctx context.Context, userID string, from, to time.Time, limit int) ([]*Run, error)
	RunsInState(ctx context.Context, userID string, state RunState) ([]*Run, error)
}

type MemoryStore struct {
	mu     sync.Mutex
	rules  map[string]Rules
	runs   map[string]*Run
	byCred map[string]string
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{rules: map[string]Rules{}, runs: map[string]*Run{}, byCred: map[string]string{}}
}

func (m *MemoryStore) GetRules(ctx context.Context, userID string) (Rules, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rules[userID]
	return r, ok, nil
}

func (m *MemoryStore) PutRules(ctx context.Context, r Rules) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rules[r.UserID] = r
	return nil
}

func (m *MemoryStore) ActiveUsers(ctx context.Context) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for id, r := range m.rules {
		if r.Active() {
			out = append(out, id)
		}
	}
	sort.Strings(out)
	return out, nil
}

func (m *MemoryStore) CreateRun(ctx context.Context, r *Run) (*Run, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := r.UserID + "|" + r.CreditID
	if id, ok := m.byCred[k]; ok {
		return m.runs[id].clone(), false, nil
	}
	m.runs[r.ID] = r.clone()
	m.byCred[k] = r.ID
	return nil, true, nil
}

func (m *MemoryStore) GetRun(ctx context.Context, userID, id string) (*Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok || r.UserID != userID {
		return nil, ErrRunNotFound
	}
	return r.clone(), nil
}

func (m *MemoryStore) UpdateRun(ctx context.Context, r *Run) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.runs[r.ID]; !ok {
		return ErrRunNotFound
	}
	m.runs[r.ID] = r.clone()
	return nil
}

func (m *MemoryStore) ListRuns(ctx context.Context, userID string, from, to time.Time, limit int) ([]*Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Run
	for _, r := range m.runs {
		if r.UserID != userID || (!from.IsZero() && r.ReceivedAt.Before(from)) || (!to.IsZero() && !r.ReceivedAt.Before(to)) {
			continue
		}
		out = append(out, r.clone())
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].ReceivedAt.Equal(out[j].ReceivedAt) {
			return out[i].ReceivedAt.After(out[j].ReceivedAt)
		}
		return out[i].ID > out[j].ID
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *MemoryStore) RunsInState(ctx context.Context, userID string, state RunState) ([]*Run, error) {
	all, _ := m.ListRuns(ctx, userID, time.Time{}, time.Time{}, 0)
	var out []*Run
	for _, r := range all {
		if r.State == state {
			out = append(out, r)
		}
	}
	return out, nil
}
