package splitreceive

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/audit"
	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
)

var ctx = context.Background()

type rig struct {
	svc   *Service
	prov  *mock.Provider
	audit *audit.Memory
	now   time.Time
}

func newRig(t *testing.T) *rig {
	t.Helper()
	r := &rig{now: time.Date(2026, 11, 9, 9, 0, 0, 0, time.UTC)}
	r.prov = mock.New(func() time.Time { return r.now })
	mock.Seed(r.prov)
	r.audit = audit.NewMemory()
	r.svc = &Service{
		Store: NewMemoryStore(), Provider: r.prov, Audit: r.audit, Now: func() time.Time { return r.now },
		Accounts: func(c context.Context, u string) ([]bank.Account, error) { return r.prov.GetAccounts(c, u) },
	}
	return r
}

func (r *rig) setRules(t *testing.T, dests ...Destination) Rules {
	t.Helper()
	rules, err := r.svc.SetRules(ctx, mock.DemoUserID, "acc_apex_1", dests)
	if err != nil {
		t.Fatal(err)
	}
	r.now = r.now.Add(time.Minute) // credits after this count
	return rules
}

func (r *rig) credit(t *testing.T, kobo int64, verified bool) bank.Transaction {
	t.Helper()
	tx, err := r.prov.SimulateCredit("acc_apex_1", kobo, "Ada Stores", verified)
	if err != nil {
		t.Fatal(err)
	}
	r.now = r.now.Add(time.Minute)
	return tx
}

func (r *rig) bal(id string) int64 {
	b, _ := r.prov.GetBalance(ctx, id)
	return b
}

func pct(acct string, bps int) Destination { return Destination{AccountID: acct, PercentBps: bps} }

func (r *rig) checkLedger(t *testing.T) Totals {
	t.Helper()
	credits, totals, err := r.svc.Reconciliation(ctx, mock.DemoUserID, time.Time{}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range credits {
		if !c.Balanced || c.SentKobo+c.HeldKobo+c.KeptKobo != c.Run.AmountKobo {
			t.Fatalf("ledger does not add up for %s: %+v", c.Run.ID, c)
		}
	}
	if totals.SentKobo+totals.HeldKobo+totals.KeptKobo != totals.CreditKobo {
		t.Fatalf("period totals do not add up: %+v", totals)
	}
	return totals
}

func TestNormalSplitWithRemainder(t *testing.T) {
	r := newRig(t)
	r.setRules(t, pct("acc_delta_1", 3000), pct("acc_harbor_1", 2000))
	apex0, delta0, harbor0 := r.bal("acc_apex_1"), r.bal("acc_delta_1"), r.bal("acc_harbor_1")
	r.credit(t, 20_000_000, true) // N200,000
	res, err := r.svc.Scan(ctx, mock.DemoUserID)
	if err != nil || len(res.NewRuns) != 1 {
		t.Fatalf("scan: %v %+v", err, res)
	}
	run, _ := r.svc.Run(ctx, mock.DemoUserID, res.NewRuns[0])
	if run.State != RunSettled || len(run.Legs) != 2 || run.Legs[0].AmountKobo != 6_000_000 || run.Legs[1].AmountKobo != 4_000_000 {
		t.Fatalf("run %+v", run)
	}
	if r.bal("acc_delta_1") != delta0+6_000_000 || r.bal("acc_harbor_1") != harbor0+4_000_000 || r.bal("acc_apex_1") != apex0+10_000_000 {
		t.Fatalf("balances apex %d delta %d harbor %d", r.bal("acc_apex_1"), r.bal("acc_delta_1"), r.bal("acc_harbor_1"))
	}
	tot := r.checkLedger(t)
	if tot.SentKobo != 10_000_000 || tot.KeptKobo != 10_000_000 || tot.HeldKobo != 0 {
		t.Fatalf("totals %+v", tot)
	}
}

func TestFixedAndPercentMix(t *testing.T) {
	r := newRig(t)
	r.setRules(t, Destination{AccountID: "acc_delta_1", FixedKobo: 500_000}, pct("acc_harbor_1", 1000))
	r.credit(t, 10_000_000, true)
	res, _ := r.svc.Scan(ctx, mock.DemoUserID)
	run, _ := r.svc.Run(ctx, mock.DemoUserID, res.NewRuns[0])
	if run.Legs[0].AmountKobo != 500_000 || run.Legs[1].AmountKobo != 1_000_000 {
		t.Fatalf("legs %+v", run.Legs)
	}
	r.checkLedger(t)
}

func TestDuplicateNotificationSplitsOnce(t *testing.T) {
	r := newRig(t)
	r.setRules(t, pct("acc_delta_1", 5000))
	r.credit(t, 10_000_000, true)
	r.svc.Scan(ctx, mock.DemoUserID)
	after := r.bal("acc_delta_1")
	res, _ := r.svc.Scan(ctx, mock.DemoUserID)
	if len(res.NewRuns) != 0 || r.bal("acc_delta_1") != after {
		t.Fatal("a second scan split the same credit again")
	}
	runs, _ := r.svc.Runs(ctx, mock.DemoUserID, 10)
	if len(runs) != 1 {
		t.Fatalf("runs %d", len(runs))
	}
}

func TestUnverifiedCreditIsNeverSplit(t *testing.T) {
	r := newRig(t)
	r.setRules(t, pct("acc_delta_1", 5000))
	before := r.bal("acc_delta_1")
	r.credit(t, 8_000_000, false) // N80,000 pending credit
	res, _ := r.svc.Scan(ctx, mock.DemoUserID)
	if len(res.NewRuns) != 0 || res.IgnoredUnverified != 1 || r.bal("acc_delta_1") != before {
		t.Fatalf("unverified credit was touched: %+v", res)
	}
}

func TestOnlyCreditsAfterConsentAreSplit(t *testing.T) {
	r := newRig(t)
	r.credit(t, 10_000_000, true) // arrives before any rules exist
	r.setRules(t, pct("acc_delta_1", 5000))
	res, _ := r.svc.Scan(ctx, mock.DemoUserID)
	if len(res.NewRuns) != 0 {
		t.Fatal("an old credit was split retroactively")
	}
}

func TestOwnPaymentsAreNotIncomingMoney(t *testing.T) {
	r := newRig(t)
	r.setRules(t, pct("acc_delta_1", 5000))
	// A Split-Pay collection leg lands in the collector with a pay_ reference.
	_, err := r.prov.Transfer(ctx, bank.TransferRequest{FromAccountID: "acc_savanna_1", To: bank.Destination{AccountID: "acc_apex_1"}, AmountKobo: 1_000_000, Reference: "pay_1-leg-1"})
	if err != nil {
		t.Fatal(err)
	}
	if res, _ := r.svc.Scan(ctx, mock.DemoUserID); len(res.NewRuns) != 0 {
		t.Fatal("Apapo's own collection was treated as income")
	}
}

func TestP2PCreditSplitsExactlyOnceAndOwnMovementsStayIgnored(t *testing.T) {
	r := newRig(t)
	r.setRules(t, pct("acc_delta_1", 3000), pct("acc_harbor_1", 4000))

	tx, err := r.prov.SimulateP2PCredit("acc_apex_1", 10_000_000, "Bola Adeyemi", "p2p_pay_test")
	if err != nil {
		t.Fatal(err)
	}
	_ = tx

	res, err := r.svc.Scan(ctx, mock.DemoUserID)
	if err != nil || len(res.NewRuns) != 1 {
		t.Fatalf("P2P scan: %v %+v", err, res)
	}
	again, err := r.svc.Scan(ctx, mock.DemoUserID)
	if err != nil || len(again.NewRuns) != 0 {
		t.Fatalf("P2P duplicate scan: %v %+v", err, again)
	}
	run, err := r.svc.Run(ctx, mock.DemoUserID, res.NewRuns[0])
	if err != nil || run.State != RunSettled {
		t.Fatalf("P2P run: %v %+v", err, run)
	}
	if len(run.Legs) != 2 || run.Legs[0].AmountKobo != 3_000_000 || run.Legs[1].AmountKobo != 4_000_000 {
		t.Fatalf("P2P split legs: %+v", run.Legs)
	}
	tot := r.checkLedger(t)
	if tot.CreditKobo != 10_000_000 || tot.SentKobo != 7_000_000 || tot.KeptKobo != 3_000_000 {
		t.Fatalf("P2P ledger: %+v", tot)
	}

	for _, ref := range []string{"pay_test-leg-1", "rev_test-transfer", "sr_test-leg"} {
		_, err := r.prov.SimulateCreditWithReference("acc_apex_1", 500_000, "Apapo", ref)
		if err != nil {
			t.Fatal(err)
		}
	}
	ownOnly, err := r.svc.Scan(ctx, mock.DemoUserID)
	if err != nil || len(ownOnly.NewRuns) != 0 {
		t.Fatalf("own movements were split: %v %+v", err, ownOnly)
	}
}

func TestP2POnTwoUsers(t *testing.T) {
	r := newRig(t)
	r.prov.SeedBank("usr_two", "apex", "acc_two_apex")
	r.prov.SeedBank("usr_two", "delta", "acc_two_delta")

	r.setRules(t, pct("acc_delta_1", 3000))
	r.now = r.now.Add(time.Minute)
	_, err := r.svc.SetRules(ctx, "usr_two", "acc_two_apex", []Destination{pct("acc_two_delta", 4000)})
	if err != nil {
		t.Fatal(err)
	}

	_, err = r.prov.SimulateP2PCredit("acc_apex_1", 10_000_000, "Sender One", "p2p_sender_side")
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.prov.SimulateP2PCredit("acc_two_apex", 5_000_000, "Sender Two", "p2p_recipient_side")
	if err != nil {
		t.Fatal(err)
	}

	resOne, _ := r.svc.Scan(ctx, mock.DemoUserID)
	resTwo, _ := r.svc.Scan(ctx, "usr_two")
	if len(resOne.NewRuns) != 1 || len(resTwo.NewRuns) != 1 {
		t.Fatalf("two-user P2P scans: user1=%+v user2=%+v", resOne, resTwo)
	}
	runOne, _ := r.svc.Run(ctx, mock.DemoUserID, resOne.NewRuns[0])
	runTwo, _ := r.svc.Run(ctx, "usr_two", resTwo.NewRuns[0])
	if runOne.AmountKobo != 10_000_000 || runTwo.AmountKobo != 5_000_000 {
		t.Fatalf("wrong P2P runs: user1=%+v user2=%+v", runOne, runTwo)
	}
	if runOne.Legs[0].AmountKobo != 3_000_000 || runTwo.Legs[0].AmountKobo != 2_000_000 {
		t.Fatalf("wrong P2P shares: user1=%+v user2=%+v", runOne.Legs, runTwo.Legs)
	}
}

func TestFailedLegThenRetry(t *testing.T) {
	r := newRig(t)
	r.setRules(t, pct("acc_delta_1", 3000), pct("acc_harbor_1", 2000))
	r.prov.SetBankFailure("harbor", mock.FailBankDown)
	r.credit(t, 20_000_000, true)
	res, _ := r.svc.Scan(ctx, mock.DemoUserID)
	run, _ := r.svc.Run(ctx, mock.DemoUserID, res.NewRuns[0])
	if run.State != RunPartiallySettled || run.Legs[0].State != LegCollected || run.Legs[1].State != LegFailed || run.Legs[1].Error != "bank_unavailable" {
		t.Fatalf("run %+v", run)
	}
	tot := r.checkLedger(t)
	if tot.HeldKobo != 4_000_000 || tot.SentKobo != 6_000_000 {
		t.Fatalf("totals %+v", tot)
	}
	// Retrying while the bank is still down changes nothing and does not double pay leg one.
	delta := r.bal("acc_delta_1")
	run, _ = r.svc.Retry(ctx, mock.DemoUserID, run.ID)
	if run.State != RunPartiallySettled || r.bal("acc_delta_1") != delta {
		t.Fatalf("retry while down: %+v", run)
	}
	r.prov.SetBankFailure("harbor", mock.FailNone)
	run, err := r.svc.Retry(ctx, mock.DemoUserID, run.ID)
	if err != nil || run.State != RunSettled || run.Legs[1].State != LegCollected {
		t.Fatalf("retry: %v %+v", err, run)
	}
	if r.bal("acc_delta_1") != delta {
		t.Fatal("first share was paid again on retry")
	}
	if tot := r.checkLedger(t); tot.HeldKobo != 0 || tot.SentKobo != 10_000_000 {
		t.Fatalf("totals %+v", tot)
	}
	if _, err := r.svc.Retry(ctx, mock.DemoUserID, run.ID); !errors.Is(err, ErrNothingToRetry) {
		t.Fatalf("settled run retry: %v", err)
	}
}

func TestEveryLegFailingNeedsAttention(t *testing.T) {
	r := newRig(t)
	r.setRules(t, pct("acc_delta_1", 5000))
	r.prov.SetAccountFailure("acc_apex_1", mock.FailBankDown)
	r.credit(t, 10_000_000, true)
	// The receiving bank being down also hides the credit, so scan fails cleanly.
	r.prov.SetAccountFailure("acc_apex_1", mock.FailNone)
	r.prov.SetBankFailure("delta", mock.FailBankDown)
	res, _ := r.svc.Scan(ctx, mock.DemoUserID)
	run, _ := r.svc.Run(ctx, mock.DemoUserID, res.NewRuns[0])
	if run.State != RunNeedsAttention {
		t.Fatalf("state %s", run.State)
	}
	r.checkLedger(t)
}

func TestTimeoutIsUnsureAndRetrySafe(t *testing.T) {
	r := newRig(t)
	r.setRules(t, pct("acc_delta_1", 5000))
	r.prov.SetBankFailure("delta", mock.FailTimeout)
	r.credit(t, 10_000_000, true)
	res, _ := r.svc.Scan(ctx, mock.DemoUserID)
	run, _ := r.svc.Run(ctx, mock.DemoUserID, res.NewRuns[0])
	if run.State != RunNeedsAttention || run.Legs[0].Error != "timeout" {
		t.Fatalf("run %+v", run)
	}
	r.prov.SetBankFailure("delta", mock.FailNone)
	run, _ = r.svc.Retry(ctx, mock.DemoUserID, run.ID)
	if run.State != RunSettled {
		t.Fatalf("after retry %s", run.State)
	}
}

func TestRulesLargerThanCreditMoveNothing(t *testing.T) {
	r := newRig(t)
	r.setRules(t, Destination{AccountID: "acc_delta_1", FixedKobo: 50_000_000})
	delta := r.bal("acc_delta_1")
	r.credit(t, 10_000_000, true)
	res, _ := r.svc.Scan(ctx, mock.DemoUserID)
	run, _ := r.svc.Run(ctx, mock.DemoUserID, res.NewRuns[0])
	if run.State != RunNeedsAttention || len(run.Legs) != 0 || r.bal("acc_delta_1") != delta {
		t.Fatalf("run %+v", run)
	}
	if tot := r.checkLedger(t); tot.KeptKobo != 10_000_000 {
		t.Fatalf("totals %+v", tot)
	}
}

type denyAll struct{ on bool }

func (d *denyAll) Reserve(ctx context.Context, _ string, _ int64, send func(context.Context) error) error {
	if d.on {
		return ErrLimitExceeded
	}
	return send(ctx)
}

func TestDailyLimitHoldsTheShareThenRetryWorks(t *testing.T) {
	r := newRig(t)
	lim := &denyAll{on: true}
	r.svc.Limits = lim
	r.setRules(t, pct("acc_delta_1", 5000))
	r.credit(t, 10_000_000, true)
	res, _ := r.svc.Scan(ctx, mock.DemoUserID)
	run, _ := r.svc.Run(ctx, mock.DemoUserID, res.NewRuns[0])
	if run.Legs[0].Error != "daily_limit" || run.State != RunNeedsAttention {
		t.Fatalf("run %+v", run)
	}
	lim.on = false
	run, _ = r.svc.Retry(ctx, mock.DemoUserID, run.ID)
	if run.State != RunSettled {
		t.Fatalf("after limit lifted: %s", run.State)
	}
}

func TestRevokedConsentStopsEverything(t *testing.T) {
	r := newRig(t)
	r.setRules(t, pct("acc_delta_1", 5000))
	r.prov.SetBankFailure("delta", mock.FailBankDown)
	r.credit(t, 10_000_000, true)
	res, _ := r.svc.Scan(ctx, mock.DemoUserID)
	r.prov.SetBankFailure("delta", mock.FailNone)
	if err := r.svc.DisableRules(ctx, mock.DemoUserID); err != nil {
		t.Fatal(err)
	}
	if _, err := r.svc.Scan(ctx, mock.DemoUserID); !errors.Is(err, ErrNoRules) {
		t.Fatalf("scan after revoke: %v", err)
	}
	if _, err := r.svc.Retry(ctx, mock.DemoUserID, res.NewRuns[0]); !errors.Is(err, ErrNoRules) {
		t.Fatalf("retry after revoke: %v", err)
	}
	events := map[string]bool{}
	for _, e := range r.audit.All() {
		events[e.Event] = true
	}
	for _, want := range []string{"splitreceive.rules_set", "splitreceive.detected", "splitreceive.leg_failed", "splitreceive.state", "splitreceive.consent_revoked"} {
		if !events[want] {
			t.Errorf("audit missing %s", want)
		}
	}
}

func TestRuleValidation(t *testing.T) {
	r := newRig(t)
	ext := Destination{BankCode: "zenx", AccountNumber: "0123456789", PercentBps: 1000}
	cases := []struct {
		name  string
		recv  string
		dests []Destination
	}{
		{"not my receiving account", "acc_nope", []Destination{pct("acc_delta_1", 1000)}},
		{"no destinations", "acc_apex_1", nil},
		{"over 100 percent", "acc_apex_1", []Destination{pct("acc_delta_1", 6000), pct("acc_harbor_1", 5000)}},
		{"destination is receiving account", "acc_apex_1", []Destination{pct("acc_apex_1", 1000)}},
		{"not my account", "acc_apex_1", []Destination{pct("acc_stranger", 1000)}},
		{"both percent and fixed", "acc_apex_1", []Destination{{AccountID: "acc_delta_1", PercentBps: 1000, FixedKobo: 5}}},
		{"neither percent nor fixed", "acc_apex_1", []Destination{{AccountID: "acc_delta_1"}}},
		{"bad beneficiary number", "acc_apex_1", []Destination{{BankCode: "zenx", AccountNumber: "123", PercentBps: 1000}}},
		{"account and beneficiary", "acc_apex_1", []Destination{{AccountID: "acc_delta_1", BankCode: "x", PercentBps: 1000}}},
		{"duplicate destination", "acc_apex_1", []Destination{pct("acc_delta_1", 1000), pct("acc_delta_1", 1000)}},
		{"too many", "acc_apex_1", []Destination{ext, {BankCode: "a", AccountNumber: "1000000001", PercentBps: 1}, {BankCode: "a", AccountNumber: "1000000002", PercentBps: 1}, {BankCode: "a", AccountNumber: "1000000003", PercentBps: 1}, {BankCode: "a", AccountNumber: "1000000004", PercentBps: 1}, {BankCode: "a", AccountNumber: "1000000005", PercentBps: 1}}},
	}
	for _, c := range cases {
		if _, err := r.svc.SetRules(ctx, mock.DemoUserID, c.recv, c.dests); !errors.Is(err, ErrBadRules) {
			t.Errorf("%s: got %v", c.name, err)
		}
	}
	if _, err := r.svc.SetRules(ctx, mock.DemoUserID, "acc_apex_1", []Destination{ext, pct("acc_delta_1", 2000)}); err != nil {
		t.Fatalf("valid mix refused: %v", err)
	}
}

func TestBeneficiaryDestination(t *testing.T) {
	r := newRig(t)
	r.setRules(t, Destination{BankCode: "zenx", AccountNumber: "0123456789", AccountName: "Mum", PercentBps: 1000})
	r.credit(t, 10_000_000, true)
	res, _ := r.svc.Scan(ctx, mock.DemoUserID)
	run, _ := r.svc.Run(ctx, mock.DemoUserID, res.NewRuns[0])
	if run.State != RunSettled || run.Legs[0].AmountKobo != 1_000_000 {
		t.Fatalf("run %+v", run)
	}
}
