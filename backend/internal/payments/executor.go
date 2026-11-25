package payments

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/Mykelsown/apapo/backend/internal/audit"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/planner"
)

const (
	MsgRolledBack    = "We reversed the earlier steps. Your money is back."
	MsgCompleted     = "Payment sent."
	MsgNeedsReversal = "We could not return all of your money automatically. It has been flagged for review."
	MsgNeedsConfirm  = "We could not confirm one step with your bank. Nothing more will move until it is checked."
	maxTransferTries = 3
)

type Executor struct {
	Provider                     bank.Provider
	Store                        Store
	Now                          func() time.Time
	RetryDelay                   time.Duration // pause between retries of a timed out call
	ReversalRetryBase            time.Duration
	ReversalHumanReviewThreshold int
	// Logger, when set, receives audit events instead of the payment store, so one trail holds everything.
	Logger audit.Logger
}

func NewExecutor(p bank.Provider, s Store) *Executor {
	return &Executor{
		Provider: p, Store: s, Now: time.Now,
		RetryDelay:                   150 * time.Millisecond,
		ReversalRetryBase:            time.Second,
		ReversalHumanReviewThreshold: 10,
	}
}

type StartInput struct {
	UserID         string
	IdempotencyKey string
	Recipient      Recipient
	Plan           planner.Plan
}

func newID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

// Start records a planned payment. A repeat of the same key returns the original
// payment (created=false) and never plans a second one.
func (e *Executor) Start(ctx context.Context, in StartInput) (*Payment, bool, error) {
	if len(in.Plan.Legs) == 0 {
		return nil, false, errors.New("payments: plan has no legs")
	}
	now := e.Now().UTC()
	p := &Payment{
		ID: newID("pay"), UserID: in.UserID, IdempotencyKey: in.IdempotencyKey, State: StatePlanned,
		AmountKobo: in.Plan.AmountKobo, FeeKobo: in.Plan.TotalFeeKobo, Recipient: in.Recipient,
		CreatedAt: now, UpdatedAt: now,
	}
	for i, l := range in.Plan.Legs {
		p.Legs = append(p.Legs, Leg{ID: newID("leg"), AccountID: l.AccountID, BankCode: l.BankCode,
			AmountKobo: l.AmountKobo, FeeKobo: l.FeeKobo, State: LegPending, Position: i, UpdatedAt: now})
	}
	existing, created, err := e.Store.Create(ctx, p)
	if err != nil {
		return nil, false, err
	}
	if !created {
		if existing.AmountKobo != p.AmountKobo || existing.Recipient != p.Recipient {
			return nil, false, ErrIdempotencyConflict
		}
		return existing, false, nil
	}
	e.audit(ctx, p, "payment.created", map[string]any{"amount_kobo": p.AmountKobo, "legs": len(p.Legs)})
	return p, true, nil
}

// Run executes a planned payment to a final state. Running a payment that has
// already started is a no-op, so a duplicate call can never move money twice.
func (e *Executor) Run(ctx context.Context, userID, id string) error {
	p, err := e.Store.Get(ctx, userID, id)
	if err != nil {
		return err
	}
	if p.State != StatePlanned {
		return nil
	}
	if err := e.moveState(ctx, p, StateCollecting, ""); err != nil {
		return err
	}
	collector := p.Legs[0]
	// The collector's own money is already where it needs to be.
	if err := e.moveLeg(ctx, p, 0, LegCollected, "", ""); err != nil {
		return err
	}
	for i := 1; i < len(p.Legs); i++ {
		l := p.Legs[i]
		res, err := e.transfer(ctx, bank.TransferRequest{
			FromAccountID: l.AccountID,
			To:            bank.Destination{AccountID: collector.AccountID},
			AmountKobo:    l.AmountKobo,
			Reference:     fmt.Sprintf("%s-leg-%d", p.ID, i),
		})
		if err != nil {
			e.moveLeg(ctx, p, i, LegFailed, "", reason(err))
			return e.rollback(ctx, p, err)
		}
		if err := e.moveLeg(ctx, p, i, LegCollected, res.TransferID, ""); err != nil {
			return err
		}
	}
	if err := e.moveState(ctx, p, StateSending, ""); err != nil {
		return err
	}
	finalReference := p.ID + "-send"
	finalDestination := bank.Destination{BankCode: p.Recipient.BankCode, AccountNumber: p.Recipient.AccountNumber, AccountName: p.Recipient.AccountName}
	if p.Recipient.RecipientType == "apapo" {
		finalReference = "p2p_" + p.ID
		if p.Recipient.ReceivingAccount != "" {
			finalDestination = bank.Destination{AccountID: p.Recipient.ReceivingAccount}
		}
	}
	_, err = e.transfer(ctx, bank.TransferRequest{
		FromAccountID: collector.AccountID,
		To:            finalDestination,
		AmountKobo:    p.AmountKobo,
		Reference:     finalReference,
	})
	if err != nil {
		return e.rollback(ctx, p, err)
	}
	if p.Recipient.RecipientType == "apapo" && p.Recipient.ApapoUserID != "" {
		e.auditRecipient(ctx, p, "p2p.credit_confirmed", map[string]any{
			"amount_kobo":    p.AmountKobo,
			"sender_user_id": p.UserID,
			"payment_id":     p.ID,
		})
	}
	return e.moveState(ctx, p, StateCompleted, MsgCompleted)
}

// rollback returns money to the source accounts in reverse order.
func (e *Executor) rollback(ctx context.Context, p *Payment, cause error) error {
	unreversed := false
	for i := len(p.Legs) - 1; i >= 1; i-- {
		l := p.Legs[i]
		if l.State != LegCollected {
			continue
		}
		if err := e.reverse(ctx, l.ProviderRef); err != nil {
			unreversed = true
			p.Legs[i].Error = "reversal failed: " + reason(err)
			e.audit(ctx, p, "leg.reversal_failed", map[string]any{"leg": l.ID, "error": err.Error()})
			continue
		}
		if err := e.moveLeg(ctx, p, i, LegReversed, l.ProviderRef, ""); err != nil {
			return err
		}
	}
	if !unreversed && p.Legs[0].State == LegCollected {
		e.moveLeg(ctx, p, 0, LegReversed, "", "")
	}
	switch {
	case unreversed:
		return e.moveState(ctx, p, StateNeedsAttention, MsgNeedsReversal)
	case errors.Is(cause, bank.ErrTimeout):
		// The timed out step may or may not have happened, so a person must check.
		return e.moveState(ctx, p, StateNeedsAttention, MsgNeedsConfirm)
	default:
		return e.moveState(ctx, p, StateRolledBack, MsgRolledBack)
	}
}

func (e *Executor) RescanUnfinished(ctx context.Context) error {
	payments, err := e.Store.Unfinished(ctx)
	if err != nil {
		return err
	}
	for _, p := range payments {
		if err := e.retryPayment(ctx, p); err != nil {
			return err
		}
	}
	return nil
}

func (e *Executor) retryPayment(ctx context.Context, p *Payment) error {
	if p.State != StateNeedsAttention {
		return nil
	}
	now := e.Now().UTC()
	if p.NextReversalRetry != nil && now.Before(*p.NextReversalRetry) {
		return nil
	}
	remaining := false
	for i := len(p.Legs) - 1; i >= 1; i-- {
		l := &p.Legs[i]
		if l.State != LegCollected {
			continue
		}
		p.ReversalAttempts++
		p.LastReversalAttempt = &now
		p.NextReversalRetry = nil
		if p.ReversalAttempts >= e.ReversalHumanReviewThreshold {
			p.HumanReview = true
		}
		e.audit(ctx, p, "leg.reversal_retry_attempt", map[string]any{
			"leg": l.ID, "attempt": p.ReversalAttempts, "provider_ref": l.ProviderRef,
		})
		err := e.reverse(ctx, l.ProviderRef)
		if err != nil {
			l.Error = "reversal failed: " + reason(err)
			delay := e.ReversalRetryBase
			for attempt := 1; attempt < p.ReversalAttempts; attempt++ {
				if delay > 24*time.Hour/2 {
					delay = 24 * time.Hour
					break
				}
				delay *= 2
			}
			next := now.Add(delay)
			p.NextReversalRetry = &next
			e.audit(ctx, p, "leg.reversal_retry_failed", map[string]any{
				"leg": l.ID, "attempt": p.ReversalAttempts, "error": err.Error(), "next_retry": next.Format(time.RFC3339),
			})
			remaining = true
		} else {
			if err := e.moveLeg(ctx, p, i, LegReversed, l.ProviderRef, ""); err != nil {
				return err
			}
		}
	}
	if !remaining {
		allReversed := true
		for i := 1; i < len(p.Legs); i++ {
			if p.Legs[i].State != LegReversed && p.Legs[i].State != LegFailed {
				allReversed = false
			}
		}
		if allReversed {
			if p.Legs[0].State == LegCollected {
				if err := e.moveLeg(ctx, p, 0, LegReversed, "", ""); err != nil {
					return err
				}
			}
			p.NextReversalRetry = nil
			p.LastReversalAttempt = &now
			return e.moveState(ctx, p, StateRolledBack, MsgRolledBack)
		}
	}
	return e.Store.Update(ctx, p)
}

// transfer retries only timeouts. Retries reuse the reference, so they are safe.
func (e *Executor) transfer(ctx context.Context, req bank.TransferRequest) (res bank.TransferResult, err error) {
	for try := 0; try < maxTransferTries; try++ {
		res, err = e.Provider.Transfer(ctx, req)
		if !errors.Is(err, bank.ErrTimeout) {
			return res, err
		}
		time.Sleep(e.RetryDelay)
	}
	return res, err
}

func (e *Executor) reverse(ctx context.Context, transferID string) (err error) {
	for try := 0; try < maxTransferTries; try++ {
		err = e.Provider.ReverseTransfer(ctx, transferID)
		if !errors.Is(err, bank.ErrTimeout) {
			return err
		}
		time.Sleep(e.RetryDelay)
	}
	return err
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

func (e *Executor) moveState(ctx context.Context, p *Payment, to State, msg string) error {
	if !CanMove(p.State, to) {
		return fmt.Errorf("%w: %s to %s", ErrBadTransition, p.State, to)
	}
	from := p.State
	p.State, p.UpdatedAt = to, e.Now().UTC()
	if msg != "" {
		p.Message = msg
	}
	if err := e.Store.Update(ctx, p); err != nil {
		return err
	}
	e.audit(ctx, p, "payment.state", map[string]any{"from": from, "to": to, "message": msg})
	return nil
}

func (e *Executor) moveLeg(ctx context.Context, p *Payment, i int, to LegState, ref, errText string) error {
	l := &p.Legs[i]
	if !CanMoveLeg(l.State, to) {
		return fmt.Errorf("%w: leg %s to %s", ErrBadTransition, l.State, to)
	}
	from := l.State
	l.State, l.UpdatedAt, l.Error = to, e.Now().UTC(), errText
	if ref != "" {
		l.ProviderRef = ref
	}
	if err := e.Store.Update(ctx, p); err != nil {
		return err
	}
	e.audit(ctx, p, "leg.state", map[string]any{"leg": l.ID, "from": from, "to": to, "error": errText})
	return nil
}

func (e *Executor) audit(ctx context.Context, p *Payment, event string, detail map[string]any) {
	if e.Logger != nil {
		e.Logger.Log(ctx, audit.Entry{UserID: p.UserID, Event: event, SubjectID: p.ID, Detail: detail, At: e.Now().UTC()})
		return
	}
	e.Store.Audit(ctx, AuditEntry{UserID: p.UserID, Event: event, SubjectID: p.ID, Detail: detail, At: e.Now().UTC()})
}

func (e *Executor) auditRecipient(ctx context.Context, p *Payment, event string, detail map[string]any) {
	if e.Logger != nil {
		e.Logger.Log(ctx, audit.Entry{UserID: p.Recipient.ApapoUserID, Event: event, SubjectID: p.ID, Detail: detail, At: e.Now().UTC()})
		return
	}
	e.Store.Audit(ctx, AuditEntry{UserID: p.Recipient.ApapoUserID, Event: event, SubjectID: p.ID, Detail: detail, At: e.Now().UTC()})
}
