package splitreceive

import (
	"os"
	"testing"

	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
	"github.com/Mykelsown/apapo/backend/internal/db"
)

func TestPostgresSplitAndRetryAndLedger(t *testing.T) {
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
	d.Exec(`DELETE FROM user_limits; DELETE FROM shield_dismissals; DELETE FROM reports; DELETE FROM split_receive_legs; DELETE FROM split_receive_runs; DELETE FROM split_receive_rules; DELETE FROM merchant_overrides; DELETE FROM split_receive_legs; DELETE FROM split_receive_runs; DELETE FROM split_receive_rules; DELETE FROM sessions; DELETE FROM otp_codes; DELETE FROM audit_log; DELETE FROM linked_accounts; DELETE FROM transfer_legs; DELETE FROM transfers; DELETE FROM users`)
	d.Exec(`INSERT INTO users (id, phone) VALUES ($1, '+2348012345678')`, mock.DemoUserID)

	r := newRig(t)
	r.svc.Store = PGStore{DB: d}
	r.setRules(t, pct("acc_delta_1", 2500), Destination{BankCode: "savanna", AccountNumber: "0123456789", FixedKobo: 300000})
	r.credit(t, 2_000_000, true)
	res, err := r.svc.Scan(ctx, mock.DemoUserID)
	if err != nil || len(res.NewRuns) != 1 {
		t.Fatalf("scan %+v %v", res, err)
	}
	if again, _ := r.svc.Scan(ctx, mock.DemoUserID); len(again.NewRuns) != 0 {
		t.Fatal("same credit split twice in Postgres")
	}
	run, err := r.svc.Run(ctx, mock.DemoUserID, res.NewRuns[0])
	if err != nil || run.State != RunSettled || len(run.Legs) != 2 {
		t.Fatalf("run %+v %v", run, err)
	}
	r.checkLedger(t)
}

func TestPostgresP2PCreditSplitsExactlyOnce(t *testing.T) {
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
	d.Exec(`DELETE FROM split_receive_legs; DELETE FROM split_receive_runs; DELETE FROM split_receive_rules; DELETE FROM users`)
	d.Exec(`INSERT INTO users (id, phone) VALUES ($1, '+2348099990024')`, mock.DemoUserID)

	r := newRig(t)
	r.svc.Store = PGStore{DB: d}
	r.setRules(t, pct("acc_delta_1", 3000))
	_, err = r.prov.SimulateP2PCredit("acc_apex_1", 10_000_000, "Bola Adeyemi", "p2p_postgres_test")
	if err != nil {
		t.Fatal(err)
	}
	res, err := r.svc.Scan(ctx, mock.DemoUserID)
	if err != nil || len(res.NewRuns) != 1 {
		t.Fatalf("P2P scan: %v %+v", err, res)
	}
	again, err := r.svc.Scan(ctx, mock.DemoUserID)
	if err != nil || len(again.NewRuns) != 0 {
		t.Fatalf("P2P duplicate: %v %+v", err, again)
	}
	runs, err := r.svc.Runs(ctx, mock.DemoUserID, 10)
	if err != nil || len(runs) != 1 {
		t.Fatalf("P2P runs: %v %+v", err, runs)
	}
	run, err := r.svc.Run(ctx, mock.DemoUserID, runs[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if run.AmountKobo != 10_000_000 || run.Legs[0].AmountKobo != 3_000_000 {
		t.Fatalf("P2P run: %+v", run)
	}
}
