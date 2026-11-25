package limits

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/db"
)

// fireReserves runs n concurrent reservations of amount, spread over the given
// services, and reports how many passed and how many were refused for the limit.
func fireReserves(t *testing.T, svcs []*Service, n int, amount int64, record func(ctx context.Context) error) (ok, refused int) {
	t.Helper()
	var wg sync.WaitGroup
	var okN, refN, other atomic.Int64
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(s *Service) {
			defer wg.Done()
			<-start
			err := s.Reserve(context.Background(), "u1", amount, record)
			var ex *ExceededError
			switch {
			case err == nil:
				okN.Add(1)
			case errors.As(err, &ex):
				refN.Add(1)
			default:
				other.Add(1)
				t.Errorf("unexpected error: %v", err)
			}
		}(svcs[i%len(svcs)])
	}
	close(start)
	wg.Wait()
	return int(okN.Load()), int(refN.Load())
}

func TestReserveIsAtomicPerUser(t *testing.T) {
	var mu sync.Mutex
	spent := int64(0)
	src := func(context.Context, string, time.Time) (int64, error) {
		mu.Lock()
		v := spent
		mu.Unlock()
		time.Sleep(time.Millisecond) // widen the gap between reading and recording
		return v, nil
	}
	record := func(context.Context) error {
		mu.Lock()
		spent += 300_000
		mu.Unlock()
		return nil
	}
	s := &Service{Store: NewMemoryStore(), Sources: []Spent{src}}
	if err := s.Set(context.Background(), "u1", 1_000_000); err != nil {
		t.Fatal(err)
	}
	// N10,000 limit, N3,000 each: exactly 3 of 20 fit.
	ok, refused := fireReserves(t, []*Service{s}, 20, 300_000, record)
	if ok != 3 || refused != 17 || spent != 900_000 {
		t.Fatalf("ok=%d refused=%d spent=%d", ok, refused, spent)
	}
}

func TestReserveDoesNotBlockOtherUsers(t *testing.T) {
	s := &Service{Store: NewMemoryStore()}
	hold := make(chan struct{})
	held := make(chan struct{})
	go s.Reserve(context.Background(), "a", 1, func(context.Context) error { close(held); <-hold; return nil })
	<-held
	done := make(chan error, 1)
	go func() { done <- s.Reserve(context.Background(), "b", 1, func(context.Context) error { return nil }) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("user b waited on user a's lock")
	}
	// A caller for the same user gives up when its context ends.
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := s.Reserve(ctx, "a", 1, func(context.Context) error { return nil }); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want deadline, got %v", err)
	}
	close(hold)
}

// Two services with their own PGLocker stand in for two API instances sharing one database.
func TestPostgresReserveAcrossInstances(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	d, err := db.Open(url)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	ctx := context.Background()
	if _, err := d.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS limits_test_spend (user_id TEXT NOT NULL, kobo BIGINT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	defer d.ExecContext(ctx, `DROP TABLE limits_test_spend`)
	d.ExecContext(ctx, `DELETE FROM limits_test_spend`)
	src := func(ctx context.Context, u string, _ time.Time) (int64, error) {
		var v int64
		err := d.QueryRowContext(ctx, `SELECT COALESCE(SUM(kobo),0) FROM limits_test_spend WHERE user_id=$1`, u).Scan(&v)
		time.Sleep(time.Millisecond)
		return v, err
	}
	record := func(ctx context.Context) error {
		_, err := d.ExecContext(ctx, `INSERT INTO limits_test_spend VALUES ('u1', 300000)`)
		return err
	}
	store := NewMemoryStore()
	store.Set(ctx, "u1", 1_000_000, time.Now())
	a := &Service{Store: store, Sources: []Spent{src}, Locker: NewPGLocker(d)}
	b := &Service{Store: store, Sources: []Spent{src}, Locker: NewPGLocker(d)}
	ok, refused := fireReserves(t, []*Service{a, b}, 20, 300_000, record)
	var total int64
	d.QueryRowContext(ctx, `SELECT COALESCE(SUM(kobo),0) FROM limits_test_spend`).Scan(&total)
	if ok != 3 || refused != 17 || total != 900_000 {
		t.Fatalf("ok=%d refused=%d recorded=%d", ok, refused, total)
	}
}
