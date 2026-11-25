package payments

import (
	"os"
	"testing"

	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
	"github.com/Mykelsown/apapo/backend/internal/db"
)

// Runs the full rollback scenario against real Postgres when TEST_DATABASE_URL is set.
func TestPostgresStoreRollbackAndIdempotency(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	d, err := db.Open(url)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := db.Migrate(ctx, d); err != nil {
		t.Fatal(err)
	}
	d.Exec(`DELETE FROM user_limits; DELETE FROM shield_dismissals; DELETE FROM reports; DELETE FROM split_receive_legs; DELETE FROM split_receive_runs; DELETE FROM split_receive_rules; DELETE FROM merchant_overrides; DELETE FROM audit_log; DELETE FROM transfer_legs; DELETE FROM transfers; DELETE FROM users`)
	if _, err := d.Exec(`INSERT INTO users (id, phone) VALUES ($1, '+2348000000000')`, mock.DemoUserID); err != nil {
		t.Fatal(err)
	}

	r := newRig(t)
	pg := PGStore{DB: d}
	r.store, r.exec.Store = nil, pg
	r.prov.SetAccountFailure("acc_savanna_1", mock.FailBankDown)
	p := r.start(t, "pg-key")
	if again, created, err := r.exec.Start(ctx, StartInput{UserID: mock.DemoUserID, IdempotencyKey: "pg-key",
		Recipient: Recipient{BankCode: "ext", AccountNumber: "0123456789"}, Plan: r.plan}); err != nil || created || again.ID != p.ID {
		t.Fatalf("duplicate: %v created=%v", err, created)
	}
	if err := r.exec.Run(ctx, mock.DemoUserID, p.ID); err != nil {
		t.Fatal(err)
	}
	got, err := pg.Get(ctx, mock.DemoUserID, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != StateRolledBack || len(got.Legs) != 3 || got.Legs[0].State != LegReversed || got.Legs[2].State != LegFailed {
		t.Fatalf("stored payment wrong: %+v", got)
	}
	var n int
	d.QueryRow(`SELECT count(*) FROM audit_log WHERE subject_id=$1`, p.ID).Scan(&n)
	if n < 6 {
		t.Fatalf("expected an audit trail, got %d rows", n)
	}
}

func TestPostgresUnfinishedReversalRetry(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	d, err := db.Open(url)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := db.Migrate(ctx, d); err != nil {
		t.Fatal(err)
	}
	d.Exec(`DELETE FROM transfer_legs; DELETE FROM transfers; DELETE FROM users`)
	if _, err := d.Exec(`INSERT INTO users (id, phone) VALUES ($1, '+2348000000000') ON CONFLICT (id) DO NOTHING`, mock.DemoUserID); err != nil {
		t.Fatal(err)
	}

	pg := PGStore{DB: d}
	r := newRig(t)
	p := r.start(t, "pg-retry-1")
	p.State = StateNeedsAttention
	p.ReversalAttempts = 2
	p.HumanReview = false
	now := r.exec.Now().UTC()
	p.NextReversalRetry = &now
	p.LastReversalAttempt = &now

	if _, created, err := pg.Create(ctx, p); err != nil || !created {
		t.Fatalf("create unfinished payment: %v created=%v", err, created)
	}
	if err := pg.Update(ctx, p); err != nil {
		t.Fatal(err)
	}
	unfinished, err := pg.Unfinished(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, x := range unfinished {
		if x.ID == p.ID {
			found = true
			if x.ReversalAttempts != 2 || x.NextReversalRetry == nil {
				t.Fatalf("retry fields not persisted: %+v", x)
			}
		}
	}
	if !found {
		t.Fatal("unfinished payment missing from Postgres rescan")
	}
	p.State = StateRolledBack
	p.NextReversalRetry = nil
	if err := pg.Update(ctx, p); err != nil {
		t.Fatal(err)
	}
	unfinished, err = pg.Unfinished(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range unfinished {
		if x.ID == p.ID {
			t.Fatal("rolled_back payment still in unfinished rescan")
		}
	}
}

func TestPostgresPaymentHistoryOwnership(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	d, err := db.Open(url)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := db.Migrate(ctx, d); err != nil {
		t.Fatal(err)
	}
	d.Exec(`DELETE FROM transfer_legs; DELETE FROM transfers; DELETE FROM users`)
	if _, err := d.Exec(`INSERT INTO users (id, phone) VALUES ($1, '+2348000000000') ON CONFLICT (id) DO NOTHING`, mock.DemoUserID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO users (id, phone) VALUES ('usr_two', '+2348099990032') ON CONFLICT (id) DO NOTHING`); err != nil {
		t.Fatal(err)
	}

	pg := PGStore{DB: d}
	r := newRig(t)
	p1 := r.start(t, "pg-history-1")
	p2, _, err := r.exec.Start(ctx, StartInput{
		UserID: mock.DemoUserID, IdempotencyKey: "pg-history-2",
		Recipient: Recipient{RecipientType: "apapo", ApapoPhone: "+2348098765432", ApapoMaskedName: "Bola A."},
		Plan:      r.plan,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, created, err := pg.Create(ctx, p1); err != nil || !created {
		t.Fatalf("create history payment one: %v created=%v", err, created)
	}
	if _, created, err := pg.Create(ctx, p2); err != nil || !created {
		t.Fatalf("create history payment two: %v created=%v", err, created)
	}

	userTwo := &Payment{
		ID: "pay_user_two", UserID: "usr_two", IdempotencyKey: "pg-history-user-two",
		State: StateCompleted, AmountKobo: 50_000, Recipient: Recipient{BankCode: "apex", AccountNumber: "0123456789"},
		CreatedAt: r.exec.Now().UTC(), UpdatedAt: r.exec.Now().UTC(),
	}
	if _, err := d.Exec(`INSERT INTO users (id, phone) VALUES ('usr_two', '+2348099990032') ON CONFLICT (id) DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	if _, created, err := pg.Create(ctx, userTwo); err != nil || !created {
		t.Fatalf("create user two payment: %v created=%v", err, created)
	}

	page, err := pg.ListSent(ctx, mock.DemoUserID, 1, "")
	if err != nil || len(page) != 1 {
		t.Fatalf("Postgres first page: %v %+v", err, page)
	}
	next, err := pg.ListSent(ctx, mock.DemoUserID, 1, page[0].ID)
	if err != nil || len(next) != 1 {
		t.Fatalf("Postgres next page: %v %+v", err, next)
	}
	for _, p := range append(page, next...) {
		if p.UserID != mock.DemoUserID {
			t.Fatalf("ownership leak: %+v", p)
		}
	}
	other, err := pg.ListSent(ctx, "usr_two", 50, "")
	if err != nil || len(other) != 1 || other[0].ID != "pay_user_two" {
		t.Fatalf("Postgres user two: %v %+v", err, other)
	}
}
