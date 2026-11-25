package payments

import (
	"context"
	"sort"
	"sync"
	"time"
)

type AuditEntry struct {
	UserID    string
	Event     string
	SubjectID string
	Detail    map[string]any
	At        time.Time
}

type Store interface {
	// Create saves a new payment. If the user already used this idempotency key it
	// returns the original payment and created=false.
	Create(ctx context.Context, p *Payment) (existing *Payment, created bool, err error)
	Get(ctx context.Context, userID, id string) (*Payment, error)
	// GetByKey finds a user's payment by idempotency key, or ErrNotFound.
	GetByKey(ctx context.Context, userID, key string) (*Payment, error)
	Unfinished(ctx context.Context) ([]*Payment, error)
	// Update saves the payment and all its legs.
	Update(ctx context.Context, p *Payment) error
	// Recent returns a user's latest payments, newest first, without legs.
	Recent(ctx context.Context, userID string, limit int) ([]*Payment, error)
	ListSent(ctx context.Context, userID string, limit int, beforeID string) ([]*Payment, error)
	Audit(ctx context.Context, e AuditEntry) error
}

// MemoryStore is used in tests and when no database is configured.
type MemoryStore struct {
	mu    sync.Mutex
	byID  map[string]*Payment
	byKey map[string]string
	audit []AuditEntry
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{byID: map[string]*Payment{}, byKey: map[string]string{}}
}

func (m *MemoryStore) Create(ctx context.Context, p *Payment) (*Payment, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := p.UserID + "|" + p.IdempotencyKey
	if id, ok := m.byKey[k]; ok {
		return m.byID[id].clone(), false, nil
	}
	m.byID[p.ID] = p.clone()
	m.byKey[k] = p.ID
	return nil, true, nil
}

func (m *MemoryStore) Get(ctx context.Context, userID, id string) (*Payment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.byID[id]
	if !ok || p.UserID != userID {
		return nil, ErrNotFound
	}
	return p.clone(), nil
}

func (m *MemoryStore) GetByKey(ctx context.Context, userID, key string) (*Payment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.byKey[userID+"|"+key]
	if !ok {
		return nil, ErrNotFound
	}
	return m.byID[id].clone(), nil
}

func (m *MemoryStore) Update(ctx context.Context, p *Payment) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.byID[p.ID]; !ok {
		return ErrNotFound
	}
	m.byID[p.ID] = p.clone()
	return nil
}

func (m *MemoryStore) Audit(ctx context.Context, e AuditEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.audit = append(m.audit, e)
	return nil
}

// AuditEntries returns a copy of the audit trail (tests and debugging).
func (m *MemoryStore) AuditEntries() []AuditEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]AuditEntry(nil), m.audit...)
}

func (m *MemoryStore) Unfinished(ctx context.Context) ([]*Payment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Payment
	for _, p := range m.byID {
		if p.State == StateNeedsAttention {
			out = append(out, p.clone())
		}
	}
	return out, nil
}

func (m *MemoryStore) Recent(ctx context.Context, userID string, limit int) ([]*Payment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Payment
	for _, p := range m.byID {
		if p.UserID == userID {
			out = append(out, p.clone())
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *MemoryStore) ListSent(ctx context.Context, userID string, limit int, beforeID string) ([]*Payment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Payment
	for _, p := range m.byID {
		if p.UserID == userID {
			out = append(out, p.clone())
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID > out[j].ID
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	start := 0
	if beforeID != "" {
		for i, p := range out {
			if p.ID == beforeID {
				start = i + 1
				break
			}
		}
		if start == 0 {
			return []*Payment{}, nil
		}
	}
	out = out[start:]
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
