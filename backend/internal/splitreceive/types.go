// Package splitreceive divides an incoming, confirmed credit across the user's
// accounts by rules they set once, and keeps a ledger that always adds up.
package splitreceive

import (
	"errors"
	"time"
)

type RunState string

const (
	RunDetected         RunState = "detected"
	RunSplitting        RunState = "splitting"
	RunSettled          RunState = "settled"
	RunPartiallySettled RunState = "partially_settled"
	RunNeedsAttention   RunState = "needs_attention"
)

type LegState string

const (
	LegPending   LegState = "pending"
	LegCollected LegState = "collected" // sent
	LegFailed    LegState = "failed"
)

const MaxDestinations = 5

// Destination is one place a share goes: an account of the user's own (AccountID)
// or a saved beneficiary (BankCode and AccountNumber). A share is a percentage in
// basis points (3000 is 30 percent) or a fixed amount in kobo, never both.
type Destination struct {
	AccountID     string `json:"account_id,omitempty"`
	BankCode      string `json:"bank_code,omitempty"`
	AccountNumber string `json:"account_number,omitempty"`
	AccountName   string `json:"account_name,omitempty"`
	PercentBps    int    `json:"percent_bps,omitempty"`
	FixedKobo     int64  `json:"fixed_kobo,omitempty"`
}

// Rules are the user's standing instruction. Whatever is not sent stays in the receiving account.
type Rules struct {
	UserID             string
	ReceivingAccountID string
	Destinations       []Destination
	// ConsentAt is when the user agreed to automatic splitting. Only credits that arrive
	// after it are ever split.
	ConsentAt time.Time
	RevokedAt *time.Time
	UpdatedAt time.Time
}

func (r Rules) Active() bool { return r.RevokedAt == nil }

type Leg struct {
	ID          string
	Position    int
	Dest        Destination
	AmountKobo  int64
	FeeKobo     int64
	State       LegState
	ProviderRef string
	Error       string
	UpdatedAt   time.Time
}

type Run struct {
	ID         string
	UserID     string
	CreditID   string
	AccountID  string
	AmountKobo int64
	ReceivedAt time.Time
	State      RunState
	Message    string
	Legs       []Leg
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func (r *Run) clone() *Run {
	c := *r
	c.Legs = append([]Leg(nil), r.Legs...)
	return &c
}

var (
	ErrNoRules        = errors.New("splitreceive: no active rules")
	ErrBadRules       = errors.New("splitreceive: invalid rules")
	ErrRunNotFound    = errors.New("splitreceive: run not found")
	ErrNothingToRetry = errors.New("splitreceive: nothing to retry")
	ErrLimitExceeded  = errors.New("splitreceive: daily limit would be exceeded")
)

// BadRulesError says what is wrong, in words the screen can show.
type BadRulesError struct{ Reason string }

func (e *BadRulesError) Error() string   { return "splitreceive: invalid rules: " + e.Reason }
func (e *BadRulesError) Is(t error) bool { return t == ErrBadRules }
