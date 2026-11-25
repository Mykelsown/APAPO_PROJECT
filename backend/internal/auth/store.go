package auth

import (
	"context"
	"sort"
	"sync"
	"time"
)

type Store interface {
	UpsertUserByPhone(ctx context.Context, id, phone string, now time.Time) (User, error)
	GetUser(ctx context.Context, id string) (User, error)
	GetUserByPhone(ctx context.Context, phone string) (User, error)
	UpdateUser(ctx context.Context, u User) error

	GetOTP(ctx context.Context, phone string) (OTP, bool, error)
	PutOTP(ctx context.Context, o OTP) error
	DeleteOTP(ctx context.Context, phone string) error

	PutSession(ctx context.Context, s Session) error
	GetSessionByAccessHash(ctx context.Context, h string) (Session, error)
	GetSessionByRefreshHash(ctx context.Context, h string) (Session, error)
	RevokeSession(ctx context.Context, id string, at time.Time) error
	RevokeUserSessions(ctx context.Context, userID string, at time.Time) error
	// ListSessions returns the user's sessions that are not revoked and whose refresh token is still valid.
	ListSessions(ctx context.Context, userID string, now time.Time) ([]Session, error)
}

type MemoryStore struct {
	mu       sync.Mutex
	users    map[string]User
	otps     map[string]OTP
	sessions map[string]Session
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{users: map[string]User{}, otps: map[string]OTP{}, sessions: map[string]Session{}}
}

func (m *MemoryStore) UpsertUserByPhone(ctx context.Context, id, phone string, now time.Time) (User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if u.Phone == phone {
			return u, nil
		}
	}
	u := User{ID: id, Phone: phone, CreatedAt: now}
	m.users[id] = u
	return u, nil
}

func (m *MemoryStore) GetUser(ctx context.Context, id string) (User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[id]
	if !ok {
		return User{}, ErrUserNotFound
	}
	return u, nil
}

func (m *MemoryStore) GetUserByPhone(ctx context.Context, phone string) (User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if u.Phone == phone {
			return u, nil
		}
	}
	return User{}, ErrUserNotFound
}

func (m *MemoryStore) UpdateUser(ctx context.Context, u User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.users[u.ID]; !ok {
		return ErrUserNotFound
	}
	m.users[u.ID] = u
	return nil
}

func (m *MemoryStore) GetOTP(ctx context.Context, phone string) (OTP, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.otps[phone]
	return o, ok, nil
}

func (m *MemoryStore) PutOTP(ctx context.Context, o OTP) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.otps[o.Phone] = o
	return nil
}

func (m *MemoryStore) DeleteOTP(ctx context.Context, phone string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.otps, phone)
	return nil
}

func (m *MemoryStore) PutSession(ctx context.Context, s Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[s.ID] = s
	return nil
}

func (m *MemoryStore) find(f func(Session) bool) (Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		if f(s) {
			return s, nil
		}
	}
	return Session{}, ErrInvalidToken
}

func (m *MemoryStore) GetSessionByAccessHash(ctx context.Context, h string) (Session, error) {
	return m.find(func(s Session) bool { return s.AccessHash == h })
}

func (m *MemoryStore) GetSessionByRefreshHash(ctx context.Context, h string) (Session, error) {
	return m.find(func(s Session) bool { return s.RefreshHash == h })
}

func (m *MemoryStore) RevokeSession(ctx context.Context, id string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[id]; ok && s.RevokedAt == nil {
		s.RevokedAt = &at
		m.sessions[id] = s
	}
	return nil
}

func (m *MemoryStore) RevokeUserSessions(ctx context.Context, userID string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, s := range m.sessions {
		if s.UserID == userID && s.RevokedAt == nil {
			s.RevokedAt = &at
			m.sessions[id] = s
		}
	}
	return nil
}

func (m *MemoryStore) ListSessions(ctx context.Context, userID string, now time.Time) ([]Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Session
	for _, s := range m.sessions {
		if s.UserID == userID && s.RevokedAt == nil && now.Before(s.RefreshExpires) {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RefreshExpires.After(out[j].RefreshExpires) })
	return out, nil
}
