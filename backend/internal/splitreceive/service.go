package splitreceive

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/audit"
	"github.com/Mykelsown/apapo/backend/internal/bank"
)

// Limiter lets the security layer (B8) veto a transfer, for example over a daily limit.
// Reserve checks the amount and, while holding the user's limit lock, runs send,
// which must record the leg as sent before it returns. It does not call send when
// the amount does not fit.
type Limiter interface {
	Reserve(ctx context.Context, userID string, amountKobo int64, send func(ctx context.Context) error) error
}

type Service struct {
	Store    Store
	Provider bank.Provider
	// Accounts returns the user's accounts at active links, so rules can only point at real ones.
	Accounts func(ctx context.Context, userID string) ([]bank.Account, error)
	Audit    audit.Logger
	Limits   Limiter
	Now      func() time.Time
	// Fee is the bank's charge for one transfer, shown in the ledger.
	Fee        func(bankCode string) int64
	RetryDelay time.Duration

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func (s *Service) userLock(id string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.locks == nil {
		s.locks = map[string]*sync.Mutex{}
	}
	if s.locks[id] == nil {
		s.locks[id] = &sync.Mutex{}
	}
	return s.locks[id]
}

func newID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

var acctRe = regexp.MustCompile(`^\d{10}$`)

// SetRules validates and saves the rules, and records the user's standing consent.
// Only credits that arrive after this moment are ever split.
func (s *Service) SetRules(ctx context.Context, userID, receivingAccountID string, dests []Destination) (Rules, error) {
	bad := func(format string, a ...any) (Rules, error) {
		return Rules{}, &BadRulesError{Reason: fmt.Sprintf(format, a...)}
	}
	accs, err := s.Accounts(ctx, userID)
	if err != nil {
		return Rules{}, err
	}
	own := map[string]bank.Account{}
	for _, a := range accs {
		own[a.ID] = a
	}
	if _, ok := own[receivingAccountID]; !ok {
		return bad("the receiving account is not one of your linked accounts")
	}
	if len(dests) == 0 || len(dests) > MaxDestinations {
		return bad("add between 1 and %d destinations", MaxDestinations)
	}
	totalBps := 0
	seen := map[string]bool{}
	for i, d := range dests {
		key := d.AccountID
		switch {
		case d.AccountID != "" && (d.BankCode != "" || d.AccountNumber != ""):
			return bad("destination %d must be an account of yours or a beneficiary, not both", i+1)
		case d.AccountID != "":
			if _, ok := own[d.AccountID]; !ok {
				return bad("destination %d is not one of your linked accounts", i+1)
			}
			if d.AccountID == receivingAccountID {
				return bad("destination %d is the receiving account itself", i+1)
			}
		case d.BankCode != "" && acctRe.MatchString(d.AccountNumber):
			key = d.BankCode + "/" + d.AccountNumber
		default:
			return bad("destination %d needs an account of yours or a bank and 10 digit account number", i+1)
		}
		if seen[key] {
			return bad("destination %d is listed twice", i+1)
		}
		seen[key] = true
		hasPct, hasFixed := d.PercentBps != 0, d.FixedKobo != 0
		if hasPct == hasFixed {
			return bad("destination %d needs either a percent or a fixed amount", i+1)
		}
		if d.PercentBps < 0 || d.FixedKobo < 0 || d.PercentBps > 10000 {
			return bad("destination %d has an amount out of range", i+1)
		}
		totalBps += d.PercentBps
	}
	if totalBps > 10000 {
		return bad("percentages add up to more than 100 percent")
	}
	now := s.Now().UTC()
	r := Rules{UserID: userID, ReceivingAccountID: receivingAccountID, Destinations: dests, ConsentAt: now, UpdatedAt: now}
	if err := s.Store.PutRules(ctx, r); err != nil {
		return Rules{}, err
	}
	s.audit(ctx, userID, "splitreceive.rules_set", receivingAccountID, now, map[string]any{"destinations": len(dests), "standing_consent": true})
	return r, nil
}

// DisableRules ends the standing consent. Nothing is split after this.
func (s *Service) DisableRules(ctx context.Context, userID string) error {
	r, ok, err := s.Store.GetRules(ctx, userID)
	if err != nil {
		return err
	}
	if !ok || !r.Active() {
		return ErrNoRules
	}
	now := s.Now().UTC()
	r.RevokedAt, r.UpdatedAt = &now, now
	if err := s.Store.PutRules(ctx, r); err != nil {
		return err
	}
	s.audit(ctx, userID, "splitreceive.consent_revoked", r.ReceivingAccountID, now, nil)
	return nil
}

func (s *Service) Rules(ctx context.Context, userID string) (Rules, bool, error) {
	return s.Store.GetRules(ctx, userID)
}

type ScanResult struct {
	NewRuns           []string
	IgnoredUnverified int
}

// Credits created by Apapo's own payments must never be mistaken for incoming money.
var ownPrefixes = []string{"pay_", "rev_", "sr_"}

func isOwnMovement(ref string) bool {
	for _, p := range ownPrefixes {
		if strings.HasPrefix(ref, p) {
			return true
		}
	}
	return false
}

// Scan looks for new confirmed credits on the receiving account and splits each one.
// It is safe to call as often as you like: a credit is only ever split once.
func (s *Service) Scan(ctx context.Context, userID string) (ScanResult, error) {
	l := s.userLock(userID)
	l.Lock()
	defer l.Unlock()
	var res ScanResult
	rules, ok, err := s.Store.GetRules(ctx, userID)
	if err != nil {
		return res, err
	}
	if !ok || !rules.Active() {
		return res, ErrNoRules
	}
	// Finish anything a crash left half started.
	pending, err := s.Store.RunsInState(ctx, userID, RunDetected)
	if err != nil {
		return res, err
	}
	for _, r := range pending {
		s.execute(ctx, rules, r)
	}
	now := s.Now().UTC()
	txs, err := s.Provider.GetTransactions(ctx, rules.ReceivingAccountID, rules.ConsentAt, now.Add(time.Hour))
	if err != nil {
		return res, err
	}
	sort.Slice(txs, func(i, j int) bool { return txs[i].PostedAt.Before(txs[j].PostedAt) })
	for _, tx := range txs {
		if tx.Direction != bank.Credit || tx.PostedAt.Before(rules.ConsentAt) || isOwnMovement(tx.Reference) {
			continue
		}
		if !tx.Verified {
			res.IgnoredUnverified++
			continue
		}
		run := s.buildRun(rules, tx, now)
		existing, created, err := s.Store.CreateRun(ctx, run)
		if err != nil {
			return res, err
		}
		_ = existing
		if !created {
			continue
		}
		s.audit(ctx, userID, "splitreceive.detected", run.ID, now, map[string]any{"credit_id": tx.ID, "amount_kobo": tx.AmountKobo})
		res.NewRuns = append(res.NewRuns, run.ID)
		s.execute(ctx, rules, run)
	}
	return res, nil
}

// buildRun turns a credit and the rules into a run with one leg per destination.
func (s *Service) buildRun(rules Rules, tx bank.Transaction, now time.Time) *Run {
	run := &Run{ID: newID("srr"), UserID: rules.UserID, CreditID: tx.ID, AccountID: rules.ReceivingAccountID,
		AmountKobo: tx.AmountKobo, ReceivedAt: tx.PostedAt, State: RunDetected, CreatedAt: now, UpdatedAt: now}
	var total int64
	for _, d := range rules.Destinations {
		amt := d.FixedKobo
		if d.PercentBps > 0 {
			amt = tx.AmountKobo * int64(d.PercentBps) / 10000
		}
		if amt <= 0 {
			continue // a share too small to send stays in the receiving account
		}
		total += amt
		run.Legs = append(run.Legs, Leg{ID: newID("srl"), Position: len(run.Legs), Dest: d, AmountKobo: amt, State: LegPending, UpdatedAt: now})
	}
	if total > tx.AmountKobo {
		run.Legs = nil
		run.State = RunNeedsAttention
		run.Message = "Your rules would send more than this credit. Nothing was moved."
	}
	return run
}

func (s *Service) execute(ctx context.Context, rules Rules, run *Run) {
	if run.State == RunNeedsAttention && len(run.Legs) == 0 {
		return
	}
	if run.State == RunDetected {
		s.setRun(ctx, run, RunSplitting, "")
	}
	for i := range run.Legs {
		if run.Legs[i].State == LegPending {
			s.sendLeg(ctx, rules, run, i)
		}
	}
	s.finish(ctx, run)
}

func (s *Service) sendLeg(ctx context.Context, rules Rules, run *Run, i int) {
	leg := &run.Legs[i]
	fail := func(reason string) {
		leg.State, leg.Error, leg.UpdatedAt = LegFailed, reason, s.Now().UTC()
		s.Store.UpdateRun(ctx, run)
		s.audit(ctx, run.UserID, "splitreceive.leg_failed", leg.ID, leg.UpdatedAt, map[string]any{"run": run.ID, "error": reason})
	}
	to := bank.Destination{AccountID: leg.Dest.AccountID, BankCode: leg.Dest.BankCode, AccountNumber: leg.Dest.AccountNumber, AccountName: leg.Dest.AccountName}
	called := false
	// send moves the money and records the leg as sent. Under a Limiter it runs
	// inside the user's limit lock, so the next limit check already counts it.
	send := func(ctx context.Context) error {
		called = true
		var res bank.TransferResult
		var err error
		// The reference is fixed per leg, so repeating a timed out call can never pay twice.
		for try := 0; try < 3; try++ {
			res, err = s.Provider.Transfer(ctx, bank.TransferRequest{FromAccountID: rules.ReceivingAccountID, To: to, AmountKobo: leg.AmountKobo, Reference: "sr_" + leg.ID})
			if !errors.Is(err, bank.ErrTimeout) {
				break
			}
			time.Sleep(s.RetryDelay)
		}
		if err != nil {
			return err
		}
		leg.State, leg.ProviderRef, leg.Error, leg.UpdatedAt = LegCollected, res.TransferID, "", s.Now().UTC()
		if s.Fee != nil {
			bc := leg.Dest.BankCode
			if leg.Dest.AccountID != "" {
				bc = s.bankOf(ctx, run.UserID, leg.Dest.AccountID)
			}
			leg.FeeKobo = s.Fee(bc)
		}
		return s.Store.UpdateRun(ctx, run)
	}
	var err error
	if s.Limits != nil {
		err = s.Limits.Reserve(ctx, run.UserID, leg.AmountKobo, send)
	} else {
		err = send(ctx)
	}
	switch {
	case err != nil && !called:
		fail("daily_limit")
		return
	case err != nil && leg.State == LegCollected:
		// The money moved but saving the leg failed. Never report that as a failed share.
		s.audit(ctx, run.UserID, "splitreceive.leg_save_failed", leg.ID, s.Now().UTC(), map[string]any{"run": run.ID, "error": err.Error()})
		return
	case err != nil:
		fail(reason(err))
		return
	}
	s.audit(ctx, run.UserID, "splitreceive.leg_sent", leg.ID, leg.UpdatedAt, map[string]any{"run": run.ID, "amount_kobo": leg.AmountKobo})
}

func (s *Service) bankOf(ctx context.Context, userID, accountID string) string {
	accs, _ := s.Accounts(ctx, userID)
	for _, a := range accs {
		if a.ID == accountID {
			return a.BankCode
		}
	}
	return ""
}

func reason(err error) string {
	switch {
	case errors.Is(err, bank.ErrInsufficientFunds):
		return "insufficient_funds"
	case errors.Is(err, bank.ErrBankUnavailable):
		return "bank_unavailable"
	case errors.Is(err, bank.ErrTimeout):
		return "timeout"
	default:
		return "bank_error"
	}
}

// finish sets the run's final state from what its legs did.
func (s *Service) finish(ctx context.Context, run *Run) {
	sent, failed, unsure := 0, 0, false
	for _, l := range run.Legs {
		switch l.State {
		case LegCollected:
			sent++
		case LegFailed:
			failed++
			if l.Error == "timeout" {
				unsure = true
			}
		}
	}
	switch {
	case failed == 0:
		msg := "Every share was sent."
		if len(run.Legs) == 0 {
			msg = "Nothing needed to be sent."
		}
		s.setRun(ctx, run, RunSettled, msg)
	case unsure:
		s.setRun(ctx, run, RunNeedsAttention, "We could not confirm one transfer with the bank. Retry to check it safely.")
	case sent == 0:
		s.setRun(ctx, run, RunNeedsAttention, "No share could be sent. The money is still in your receiving account. You can retry.")
	default:
		s.setRun(ctx, run, RunPartiallySettled, "Some shares were sent. The rest is still in your receiving account. You can retry.")
	}
}

func (s *Service) setRun(ctx context.Context, run *Run, to RunState, msg string) {
	from := run.State
	run.State, run.UpdatedAt = to, s.Now().UTC()
	if msg != "" || to == RunSplitting {
		run.Message = msg
	}
	s.Store.UpdateRun(ctx, run)
	s.audit(ctx, run.UserID, "splitreceive.state", run.ID, run.UpdatedAt, map[string]any{"from": from, "to": to})
}

// Retry tries every failed share again. Standing consent must still be active.
func (s *Service) Retry(ctx context.Context, userID, runID string) (*Run, error) {
	l := s.userLock(userID)
	l.Lock()
	defer l.Unlock()
	rules, ok, err := s.Store.GetRules(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !ok || !rules.Active() {
		return nil, ErrNoRules
	}
	run, err := s.Store.GetRun(ctx, userID, runID)
	if err != nil {
		return nil, err
	}
	retrying := false
	for i := range run.Legs {
		if run.Legs[i].State == LegFailed {
			run.Legs[i].State, run.Legs[i].Error = LegPending, ""
			retrying = true
		}
	}
	if !retrying {
		return nil, ErrNothingToRetry
	}
	// The receiving account in force when the credit arrived is where the money is.
	rules.ReceivingAccountID = run.AccountID
	run.State = RunSplitting
	s.execute(ctx, rules, run)
	return s.Store.GetRun(ctx, userID, runID)
}

func (s *Service) Run(ctx context.Context, userID, id string) (*Run, error) {
	return s.Store.GetRun(ctx, userID, id)
}

func (s *Service) Runs(ctx context.Context, userID string, limit int) ([]*Run, error) {
	return s.Store.ListRuns(ctx, userID, time.Time{}, time.Time{}, limit)
}

// ScanAll checks every user with active rules. The server calls it on a timer.
func (s *Service) ScanAll(ctx context.Context) {
	users, err := s.Store.ActiveUsers(ctx)
	if err != nil {
		return
	}
	for _, u := range users {
		s.Scan(ctx, u)
	}
}

func (s *Service) audit(ctx context.Context, userID, event, subject string, at time.Time, detail map[string]any) {
	if s.Audit != nil {
		s.Audit.Log(ctx, audit.Entry{UserID: userID, Event: event, SubjectID: subject, At: at, Detail: detail})
	}
}
