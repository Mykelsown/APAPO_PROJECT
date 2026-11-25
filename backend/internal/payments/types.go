// Package payments runs a split payment: collect each leg into one account,
// send the final payment, and undo everything if any step fails.
package payments

import (
	"errors"
	"time"
)

type State string

const (
	StatePlanned        State = "planned"
	StateCollecting     State = "collecting"
	StateSending        State = "sending"
	StateCompleted      State = "completed"
	StateRolledBack     State = "rolled_back"
	StateNeedsAttention State = "needs_attention"
)

type LegState string

const (
	LegPending   LegState = "pending"
	LegCollected LegState = "collected"
	LegFailed    LegState = "failed"
	LegReversed  LegState = "reversed"
)

// Allowed moves. Anything else is a bug and is refused.
var paymentMoves = map[State][]State{
	StatePlanned:        {StateCollecting},
	StateCollecting:     {StateSending, StateRolledBack, StateNeedsAttention},
	StateSending:        {StateCompleted, StateRolledBack, StateNeedsAttention},
	StateNeedsAttention: {StateRolledBack},
}

var legMoves = map[LegState][]LegState{
	LegPending:   {LegCollected, LegFailed},
	LegCollected: {LegReversed},
}

func CanMove(from, to State) bool {
	for _, s := range paymentMoves[from] {
		if s == to {
			return true
		}
	}
	return false
}

func CanMoveLeg(from, to LegState) bool {
	for _, s := range legMoves[from] {
		if s == to {
			return true
		}
	}
	return false
}

func (s State) Terminal() bool {
	return s == StateCompleted || s == StateRolledBack
}

type Recipient struct {
	BankCode         string `json:"bank_code,omitempty"`
	AccountNumber    string `json:"account_number,omitempty"`
	AccountName      string `json:"account_name,omitempty"`
	ApapoPhone       string `json:"apapo_phone,omitempty"`
	ApapoUserID      string `json:"apapo_user_id,omitempty"`
	ApapoMaskedName  string `json:"apapo_masked_name,omitempty"`
	ReceivingAccount string `json:"receiving_account_id,omitempty"`
	RecipientType    string `json:"recipient_type,omitempty"`
}

// Leg position 0 is the collector: the account every other leg pays into,
// and the account the final payment leaves from.
type Leg struct {
	ID          string
	AccountID   string
	BankCode    string
	AmountKobo  int64
	FeeKobo     int64
	State       LegState
	ProviderRef string
	Error       string
	Position    int
	UpdatedAt   time.Time
}

type Payment struct {
	ID                  string
	UserID              string
	IdempotencyKey      string
	State               State
	AmountKobo          int64
	FeeKobo             int64
	Recipient           Recipient
	Message             string
	Legs                []Leg
	CreatedAt           time.Time
	UpdatedAt           time.Time
	ReversalAttempts    int
	NextReversalRetry   *time.Time
	LastReversalAttempt *time.Time
	HumanReview         bool
}

func (p *Payment) clone() *Payment {
	c := *p
	c.Legs = append([]Leg(nil), p.Legs...)
	return &c
}

var (
	ErrNotFound            = errors.New("payments: payment not found")
	ErrIdempotencyConflict = errors.New("payments: idempotency key reused with a different payment")
	ErrBadTransition       = errors.New("payments: illegal state change")
)
