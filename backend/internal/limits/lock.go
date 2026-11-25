package limits

import (
	"context"
	"database/sql"
	"sync"
)

// Locker serialises limit decisions per user, so "check the limit, then record
// the spend" is one step. Without it two payments fired at the same instant could
// both read the same spent-so-far and both pass.
type Locker interface {
	// Lock blocks until the user's lock is held, and returns the function that releases it.
	Lock(ctx context.Context, userID string) (unlock func(), err error)
}

// MemoryLocker is a per-user mutex. It is enough for a single server process.
type MemoryLocker struct {
	mu sync.Mutex
	m  map[string]*userMutex
}

type userMutex struct {
	ch   chan struct{} // a one slot channel works as a mutex that can give up on ctx
	refs int
}

func NewMemoryLocker() *MemoryLocker { return &MemoryLocker{m: map[string]*userMutex{}} }

func (l *MemoryLocker) Lock(ctx context.Context, userID string) (func(), error) {
	l.mu.Lock()
	if l.m == nil {
		l.m = map[string]*userMutex{}
	}
	um := l.m[userID]
	if um == nil {
		um = &userMutex{ch: make(chan struct{}, 1)}
		l.m[userID] = um
	}
	um.refs++
	l.mu.Unlock()

	release := func() {
		l.mu.Lock()
		um.refs--
		if um.refs == 0 {
			delete(l.m, userID) // keep the map from growing with every user ever seen
		}
		l.mu.Unlock()
	}
	select {
	case um.ch <- struct{}{}:
	case <-ctx.Done():
		release()
		return nil, ctx.Err()
	}
	return func() { <-um.ch; release() }, nil
}

// PGLocker holds a Postgres transaction level advisory lock per user, so several
// API instances behind a load balancer also take turns. A local mutex is taken
// first, so waiters in this process queue in memory and never tie up pooled
// connections while the holder needs one for its own reads and writes.
type PGLocker struct {
	DB    *sql.DB
	local MemoryLocker
}

func NewPGLocker(db *sql.DB) *PGLocker { return &PGLocker{DB: db} }

func (l *PGLocker) Lock(ctx context.Context, userID string) (func(), error) {
	unlockLocal, err := l.local.Lock(ctx, userID)
	if err != nil {
		return nil, err
	}
	conn, err := l.DB.Conn(ctx)
	if err != nil {
		unlockLocal()
		return nil, err
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		conn.Close()
		unlockLocal()
		return nil, err
	}
	// Two key form: the first key keeps these locks apart from any other advisory lock.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('apapo.daily_limit'), hashtext($1))`, userID); err != nil {
		tx.Rollback()
		conn.Close()
		unlockLocal()
		return nil, err
	}
	return func() {
		// Ending the transaction releases the advisory lock.
		tx.Commit()
		conn.Close()
		unlockLocal()
	}, nil
}
