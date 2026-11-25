package payments

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
	"github.com/Mykelsown/apapo/backend/internal/planner"
)

var ctx = context.Background()

type rig struct {
	prov  *mock.Provider
	store *MemoryStore
	exec  *Executor
	plan  planner.Plan
}

func newRig(t *testing.T) *rig {
	t.Helper()
	prov := mock.New(nil)
	mock.Seed(prov)
	st := NewMemoryStore()
	ex := NewExecutor(prov, st)
	ex.RetryDelay = 0
	accs, _ := prov.GetAccounts(ctx, mock.DemoUserID)
	var in []planner.Account
	for _, a := range accs {
		in = append(in, planner.Account{ID: a.ID, BankCode: a.BankCode, BalanceKobo: a.BalanceKobo, FeeKobo: 1000})
	}
	plan, err := planner.Make(15_000_000, in, planner.Rules{})
	if err != nil || len(plan.Legs) != 3 {
		t.Fatalf("plan %v %+v", err, plan)
	}
	return &rig{prov, st, ex, plan}
}

func (r *rig) start(t *testing.T, key string) *Payment {
	t.Helper()
	p, _, err := r.exec.Start(ctx, StartInput{UserID: mock.DemoUserID, IdempotencyKey: key,
		Recipient: Recipient{BankCode: "ext", AccountNumber: "0123456789"}, Plan: r.plan})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func (r *rig) balances(t *testing.T) map[string]int64 {
	out := map[string]int64{}
	accs, _ := r.prov.GetAccounts(ctx, mock.DemoUserID)
	for _, a := range accs {
		out[a.ID] = a.BalanceKobo
	}
	return out
}

func (r *rig) get(t *testing.T, id string) *Payment {
	p, err := r.store.Get(ctx, mock.DemoUserID, id)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestAllLegsSucceed(t *testing.T) {
	r := newRig(t)
	p := r.start(t, "k1")
	if err := r.exec.Run(ctx, mock.DemoUserID, p.ID); err != nil {
		t.Fatal(err)
	}
	got := r.get(t, p.ID)
	if got.State != StateCompleted {
		t.Fatalf("state %s", got.State)
	}
	for _, l := range got.Legs {
		if l.State != LegCollected {
			t.Fatalf("leg %d is %s", l.Position, l.State)
		}
	}
	var total int64
	for _, v := range r.balances(t) {
		total += v
	}
	if total != 19_500_000-15_000_000 {
		t.Fatalf("total balance after payment %d", total)
	}
}

func TestLegThreeFailsAndEarlierLegsReverse(t *testing.T) {
	r := newRig(t)
	before := r.balances(t)
	r.prov.SetAccountFailure("acc_savanna_1", mock.FailBankDown) // leg 3
	p := r.start(t, "k2")
	if err := r.exec.Run(ctx, mock.DemoUserID, p.ID); err != nil {
		t.Fatal(err)
	}
	got := r.get(t, p.ID)
	if got.State != StateRolledBack || got.Message != MsgRolledBack {
		t.Fatalf("state %s message %q", got.State, got.Message)
	}
	want := []LegState{LegReversed, LegReversed, LegFailed}
	for i, l := range got.Legs {
		if l.State != want[i] {
			t.Errorf("leg %d is %s want %s", i+1, l.State, want[i])
		}
	}
	if got.Legs[2].Error != "bank_unavailable" {
		t.Errorf("leg 3 error %q", got.Legs[2].Error)
	}
	after := r.balances(t)
	for id, v := range before {
		if after[id] != v {
			t.Errorf("%s balance %d want %d", id, after[id], v)
		}
	}
}

func TestFinalSendFailsAndEveryLegReverses(t *testing.T) {
	r := newRig(t)
	before := r.balances(t)
	r.prov.SetAccountFailure("acc_apex_1", mock.FailBankDown) // collector cannot send out
	p := r.start(t, "k3")
	r.exec.Run(ctx, mock.DemoUserID, p.ID)
	got := r.get(t, p.ID)
	if got.State != StateRolledBack {
		t.Fatalf("state %s", got.State)
	}
	for _, l := range got.Legs {
		if l.State != LegReversed {
			t.Errorf("leg %d is %s", l.Position, l.State)
		}
	}
	for id, v := range r.balances(t) {
		if before[id] != v {
			t.Errorf("%s balance %d want %d", id, v, before[id])
		}
	}
}

type brokenReverse struct{ bank.Provider }

func (brokenReverse) ReverseTransfer(context.Context, string) error { return bank.ErrBankUnavailable }

func TestFailedReversalNeedsAttention(t *testing.T) {
	r := newRig(t)
	r.exec.Provider = brokenReverse{r.prov}
	r.prov.SetAccountFailure("acc_savanna_1", mock.FailBankDown)
	p := r.start(t, "k4")
	r.exec.Run(ctx, mock.DemoUserID, p.ID)
	got := r.get(t, p.ID)
	if got.State != StateNeedsAttention || got.Message != MsgNeedsReversal {
		t.Fatalf("state %s message %q", got.State, got.Message)
	}
	if got.Legs[1].State != LegCollected || got.Legs[1].Error == "" {
		t.Fatalf("stuck leg should stay collected with an error: %+v", got.Legs[1])
	}
	found := false
	for _, e := range r.store.AuditEntries() {
		if e.Event == "leg.reversal_failed" {
			found = true
		}
	}
	if !found {
		t.Fatal("failed reversal must be audited")
	}
}

func TestTimeoutAfterRetriesNeedsAttention(t *testing.T) {
	r := newRig(t)
	r.prov.SetAccountFailure("acc_savanna_1", mock.FailTimeout)
	p := r.start(t, "k5")
	r.exec.Run(ctx, mock.DemoUserID, p.ID)
	got := r.get(t, p.ID)
	if got.State != StateNeedsAttention || got.Message != MsgNeedsConfirm {
		t.Fatalf("state %s message %q", got.State, got.Message)
	}
	if got.Legs[0].State != LegReversed || got.Legs[1].State != LegReversed {
		t.Fatal("confirmed legs should still be returned")
	}
}

func TestDuplicateKeyReturnsOriginalAndRunsOnce(t *testing.T) {
	r := newRig(t)
	p1 := r.start(t, "same")
	p2, created, err := r.exec.Start(ctx, StartInput{UserID: mock.DemoUserID, IdempotencyKey: "same",
		Recipient: Recipient{BankCode: "ext", AccountNumber: "0123456789"}, Plan: r.plan})
	if err != nil || created || p2.ID != p1.ID {
		t.Fatalf("duplicate start: %v created=%v ids %s %s", err, created, p1.ID, p2.ID)
	}
	r.exec.Run(ctx, mock.DemoUserID, p1.ID)
	mid := r.balances(t)
	r.exec.Run(ctx, mock.DemoUserID, p1.ID) // second run must do nothing
	for id, v := range r.balances(t) {
		if mid[id] != v {
			t.Errorf("%s moved again", id)
		}
	}
}

func TestSameKeyDifferentPaymentIsRefused(t *testing.T) {
	r := newRig(t)
	r.start(t, "kk")
	_, _, err := r.exec.Start(ctx, StartInput{UserID: mock.DemoUserID, IdempotencyKey: "kk",
		Recipient: Recipient{BankCode: "ext", AccountNumber: "9999999999"}, Plan: r.plan})
	if !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("got %v", err)
	}
}

func TestAuditTrailRecordsEveryChange(t *testing.T) {
	r := newRig(t)
	p := r.start(t, "k6")
	r.exec.Run(ctx, mock.DemoUserID, p.ID)
	counts := map[string]int{}
	for _, e := range r.store.AuditEntries() {
		counts[e.Event]++
		if e.At.IsZero() || e.SubjectID != p.ID {
			t.Fatalf("bad audit entry %+v", e)
		}
	}
	// created, planned>collecting, collecting>sending, sending>completed
	if counts["payment.created"] != 1 || counts["payment.state"] != 3 || counts["leg.state"] != 3 {
		t.Fatalf("audit counts %v", counts)
	}
}

type failOnceReverse struct {
	bank.Provider
	failures int
	timeout  bool
}

func (p *failOnceReverse) ReverseTransfer(ctx context.Context, transferID string) error {
	if p.failures > 0 {
		p.failures--
		if p.timeout {
			return bank.ErrTimeout
		}
		return bank.ErrBankUnavailable
	}
	return p.Provider.ReverseTransfer(ctx, transferID)
}

type timeoutReverse struct{ bank.Provider }

func (p timeoutReverse) ReverseTransfer(context.Context, string) error {
	return bank.ErrTimeout
}

func TestReversalFailsThenSucceedsWithRetry(t *testing.T) {
	r := newRig(t)
	r.prov.SetAccountFailure("acc_savanna_1", mock.FailBankDown)
	r.exec.Provider = brokenReverse{r.prov}
	p := r.start(t, "retry-success")
	r.exec.Run(ctx, mock.DemoUserID, p.ID)
	got := r.get(t, p.ID)
	if got.State != StateNeedsAttention {
		t.Fatalf("initial state: %s", got.State)
	}

	r.exec.Provider = &failOnceReverse{Provider: r.prov, failures: 1}
	r.exec.ReversalRetryBase = 0
	if err := r.exec.RescanUnfinished(ctx); err != nil {
		t.Fatal(err)
	}
	got = r.get(t, p.ID)
	if got.State != StateNeedsAttention {
		t.Fatalf("first failed retry state: %s", got.State)
	}
	if got.ReversalAttempts != 1 || got.NextReversalRetry == nil {
		t.Fatalf("retry metadata: %+v", got)
	}

	r.exec.Provider = &failOnceReverse{Provider: r.prov, failures: 0}
	pending := r.get(t, p.ID)
	pending.NextReversalRetry = nil
	r.store.Update(ctx, pending)
	if err := r.exec.RescanUnfinished(ctx); err != nil {
		t.Fatal(err)
	}
	got = r.get(t, p.ID)
	if got.State != StateRolledBack {
		t.Fatalf("retry did not roll back: %+v", got)
	}
	if got.ReversalAttempts != 2 {
		t.Fatalf("attempt count: %d", got.ReversalAttempts)
	}
}

func TestRepeatedFailuresAndHumanReview(t *testing.T) {
	r := newRig(t)
	r.prov.SetAccountFailure("acc_savanna_1", mock.FailBankDown)
	r.exec.Provider = brokenReverse{r.prov}
	p := r.start(t, "retry-human")
	r.exec.Run(ctx, mock.DemoUserID, p.ID)
	r.exec.ReversalRetryBase = 0
	r.exec.ReversalHumanReviewThreshold = 3

	for i := 0; i < 3; i++ {
		current := r.get(t, p.ID)
		current.NextReversalRetry = nil
		r.store.Update(ctx, current)
		if err := r.exec.RescanUnfinished(ctx); err != nil {
			t.Fatal(err)
		}
	}
	got := r.get(t, p.ID)
	if got.State != StateNeedsAttention || !got.HumanReview {
		t.Fatalf("human review state: %+v", got)
	}
	found := 0
	for _, e := range r.store.AuditEntries() {
		if e.Event == "leg.reversal_retry_attempt" {
			found++
		}
	}
	if found != 3 {
		t.Fatalf("retry audit attempts: %d", found)
	}
}

func TestUnknownOutcomeStaysNeedsAttention(t *testing.T) {
	r := newRig(t)
	r.prov.SetAccountFailure("acc_savanna_1", mock.FailTimeout)
	r.exec.Provider = brokenReverse{r.prov}
	p := r.start(t, "retry-unknown")
	r.exec.Run(ctx, mock.DemoUserID, p.ID)
	got := r.get(t, p.ID)
	if got.State != StateNeedsAttention {
		t.Fatalf("unknown reversal state: %s", got.State)
	}

	r.exec.Provider = timeoutReverse{Provider: r.prov}
	r.exec.ReversalRetryBase = 0
	if err := r.exec.RescanUnfinished(ctx); err != nil {
		t.Fatal(err)
	}
	got = r.get(t, p.ID)
	if got.State != StateNeedsAttention || got.ReversalAttempts != 1 {
		t.Fatalf("unknown outcome retry: %+v", got)
	}
}

func TestRestartRescanRecoversUnfinishedPayment(t *testing.T) {
	r := newRig(t)
	r.prov.SetAccountFailure("acc_savanna_1", mock.FailBankDown)
	r.exec.Provider = brokenReverse{r.prov}
	p := r.start(t, "retry-restart")
	r.exec.Run(ctx, mock.DemoUserID, p.ID)

	restarted := NewExecutor(r.prov, r.store)
	restarted.RetryDelay = 0
	restarted.ReversalRetryBase = 0
	restarted.Provider = &failOnceReverse{Provider: r.prov, failures: 1}
	if err := restarted.RescanUnfinished(ctx); err != nil {
		t.Fatal(err)
	}
	got := r.get(t, p.ID)
	if got.State != StateNeedsAttention {
		t.Fatalf("restart preserved needs_attention: %+v", got)
	}
	restarted.Provider = r.prov
	got.NextReversalRetry = nil
	r.store.Update(ctx, got)
	if err := restarted.RescanUnfinished(ctx); err != nil {
		t.Fatal(err)
	}
	got = r.get(t, p.ID)
	if got.State != StateRolledBack {
		t.Fatalf("restart retry did not complete: %+v", got)
	}
}

func TestRetryDoesNotDoubleReverse(t *testing.T) {
	r := newRig(t)
	r.prov.SetAccountFailure("acc_savanna_1", mock.FailBankDown)
	r.exec.Provider = brokenReverse{r.prov}
	p := r.start(t, "retry-no-double")
	r.exec.Run(ctx, mock.DemoUserID, p.ID)

	r.exec.Provider = r.prov
	r.exec.ReversalRetryBase = 0
	current := r.get(t, p.ID)
	current.NextReversalRetry = nil
	r.store.Update(ctx, current)
	if err := r.exec.RescanUnfinished(ctx); err != nil {
		t.Fatal(err)
	}
	after := r.balances(t)
	if got := r.get(t, p.ID); got.State != StateRolledBack {
		t.Fatalf("expected rolled_back: %+v", got)
	}
	if err := r.exec.RescanUnfinished(ctx); err != nil {
		t.Fatal(err)
	}
	afterAgain := r.balances(t)
	for id, value := range after {
		if afterAgain[id] != value {
			t.Fatalf("double reversal %s: after=%d again=%d", id, value, afterAgain[id])
		}
	}
}

func TestStateMachineRefusesIllegalMoves(t *testing.T) {
	if CanMove(StateCompleted, StateRolledBack) || CanMove(StatePlanned, StateCompleted) || CanMoveLeg(LegReversed, LegCollected) {
		t.Fatal("illegal move allowed")
	}
	if !CanMove(StateSending, StateRolledBack) || !CanMoveLeg(LegCollected, LegReversed) {
		t.Fatal("legal move refused")
	}
}

func TestOtherUsersCannotReadAPayment(t *testing.T) {
	r := newRig(t)
	p := r.start(t, "k7")
	if _, err := r.store.Get(ctx, "someone_else", p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}

var _ = time.Second
