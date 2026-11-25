// Package planner decides how a payment is split across a user's accounts.
// It is a pure function: no network, no clock, no database, so it is easy to test.
package planner

import (
	"errors"
	"fmt"
	"sort"
)

type Strategy string

const (
	LargestFirst Strategy = "largest_first"
	LowestFee    Strategy = "lowest_fee"
)

const DefaultMaxLegs = 4

// Account is what the planner needs to know about one source account.
type Account struct {
	ID          string
	BankCode    string
	BalanceKobo int64
	// FeeKobo is the flat fee charged by this account's bank when it is used as a leg.
	FeeKobo int64
}

type Rules struct {
	Strategy Strategy
	// MinBalanceKobo is kept in every account. MinBalanceByAccount overrides it per account.
	MinBalanceKobo      int64
	MinBalanceByAccount map[string]int64
	// MaxLegs caps the number of accounts used. Zero means DefaultMaxLegs.
	MaxLegs int
}

type Leg struct {
	AccountID  string
	BankCode   string
	AmountKobo int64 // money taken from the account towards the payment
	FeeKobo    int64 // charged on top by the account's bank
}

type Plan struct {
	Legs           []Leg
	AmountKobo     int64
	TotalFeeKobo   int64
	TotalDebitKobo int64 // amount plus fees: what leaves the user's accounts
}

var (
	ErrInvalidAmount = errors.New("planner: amount must be positive")
	ErrBadStrategy   = errors.New("planner: unknown strategy")
	ErrTooManyLegs   = errors.New("planner: payment needs more accounts than the leg limit allows")
)

// InsufficientFundsError carries how short the user is, so the UI can say so.
type InsufficientFundsError struct {
	SpendableKobo int64
	ShortfallKobo int64
}

func (e *InsufficientFundsError) Error() string {
	return fmt.Sprintf("planner: insufficient funds, short by %d kobo", e.ShortfallKobo)
}

type candidate struct {
	acc       Account
	spendable int64 // balance, minus the kept minimum, minus the fee
}

// Make plans a payment of amountKobo.
func Make(amountKobo int64, accounts []Account, rules Rules) (Plan, error) {
	if amountKobo <= 0 {
		return Plan{}, ErrInvalidAmount
	}
	if rules.Strategy == "" {
		rules.Strategy = LargestFirst
	}
	if rules.Strategy != LargestFirst && rules.Strategy != LowestFee {
		return Plan{}, ErrBadStrategy
	}
	maxLegs := rules.MaxLegs
	if maxLegs <= 0 {
		maxLegs = DefaultMaxLegs
	}

	var cands []candidate
	var total int64
	for _, a := range accounts {
		min := rules.MinBalanceKobo
		if v, ok := rules.MinBalanceByAccount[a.ID]; ok {
			min = v
		}
		sp := a.BalanceKobo - min - a.FeeKobo
		if sp <= 0 {
			continue
		}
		cands = append(cands, candidate{a, sp})
		total += sp
	}
	if total < amountKobo {
		return Plan{}, &InsufficientFundsError{SpendableKobo: total, ShortfallKobo: amountKobo - total}
	}

	order := byLargest(cands)
	if rules.Strategy == LowestFee {
		// One account that covers everything beats any multi account plan on fees.
		if single := cheapestSingle(cands, amountKobo); single != nil {
			return build(amountKobo, fill(amountKobo, []candidate{*single})), nil
		}
		order = byFee(cands)
		if legs := fill(amountKobo, order); len(legs) > maxLegs {
			order = byLargest(cands) // fewer legs, so the limit may still be met
		}
	}
	chosen := fill(amountKobo, order)
	if len(chosen) > maxLegs {
		return Plan{}, ErrTooManyLegs
	}
	return build(amountKobo, chosen), nil
}

func byLargest(c []candidate) []candidate {
	out := append([]candidate(nil), c...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].spendable != out[j].spendable {
			return out[i].spendable > out[j].spendable
		}
		return out[i].acc.ID < out[j].acc.ID
	})
	return out
}

func byFee(c []candidate) []candidate {
	out := append([]candidate(nil), c...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].acc.FeeKobo != out[j].acc.FeeKobo {
			return out[i].acc.FeeKobo < out[j].acc.FeeKobo
		}
		if out[i].spendable != out[j].spendable {
			return out[i].spendable > out[j].spendable
		}
		return out[i].acc.ID < out[j].acc.ID
	})
	return out
}

func cheapestSingle(c []candidate, amount int64) *candidate {
	var best *candidate
	for i := range c {
		if c[i].spendable < amount {
			continue
		}
		if best == nil || c[i].acc.FeeKobo < best.acc.FeeKobo ||
			(c[i].acc.FeeKobo == best.acc.FeeKobo && c[i].acc.ID < best.acc.ID) {
			best = &c[i]
		}
	}
	return best
}

// fill takes accounts in order until the amount is covered. The last one gives only the remainder.
func fill(amount int64, order []candidate) []candidate {
	var out []candidate
	left := amount
	for _, c := range order {
		if left == 0 {
			break
		}
		take := c.spendable
		if take > left {
			take = left
		}
		c.spendable = take // reused here as the amount drawn from this account
		out = append(out, c)
		left -= take
	}
	return out
}

func build(amount int64, chosen []candidate) Plan {
	p := Plan{AmountKobo: amount}
	for _, c := range chosen {
		p.Legs = append(p.Legs, Leg{AccountID: c.acc.ID, BankCode: c.acc.BankCode, AmountKobo: c.spendable, FeeKobo: c.acc.FeeKobo})
		p.TotalFeeKobo += c.acc.FeeKobo
	}
	p.TotalDebitKobo = amount + p.TotalFeeKobo
	return p
}
