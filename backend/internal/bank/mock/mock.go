// Package mock is the seeded fake bank provider used for development, tests
// and the demo fallback. Failures can be forced per bank or per account.
package mock

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
)

type Failure string

const (
	FailNone              Failure = ""
	FailTimeout           Failure = "timeout"
	FailInsufficientFunds Failure = "insufficient_funds"
	FailBankDown          Failure = "bank_down"
)

type transfer struct {
	res      bank.TransferResult
	from     string
	to       string // internal account id, empty when external
	reversed bool
}

type Provider struct {
	mu          sync.Mutex
	now         func() time.Time
	accounts    map[string]*bank.Account
	txns        map[string][]bank.Transaction
	transfers   map[string]*transfer
	byReference map[string]string // reference -> transfer id
	bankFailure map[string]Failure
	accountFail map[string]Failure
	reverseDown map[string]bool // banks whose reversals fail (demo only)
	seq         int
	seedSeq     int
}

func New(now func() time.Time) *Provider {
	if now == nil {
		now = time.Now
	}
	return &Provider{
		now:         now,
		accounts:    map[string]*bank.Account{},
		txns:        map[string][]bank.Transaction{},
		transfers:   map[string]*transfer{},
		byReference: map[string]string{},
		bankFailure: map[string]Failure{},
		accountFail: map[string]Failure{},
		reverseDown: map[string]bool{},
	}
}

// SetBankFailure forces every operation touching the bank to fail. FailNone clears it.
func (p *Provider) SetBankFailure(bankCode string, f Failure) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.bankFailure[bankCode] = f
}

// SetBankReversalFailure makes every reversal that touches the bank fail while
// normal transfers keep working. It exists so the demo can show a stuck reversal
// that Apapo keeps retrying. Passing false clears it.
func (p *Provider) SetBankReversalFailure(bankCode string, down bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if down {
		p.reverseDown[bankCode] = true
	} else {
		delete(p.reverseDown, bankCode)
	}
}

// SetAccountFailure forces transfers out of one account to fail. FailNone clears it.
func (p *Provider) SetAccountFailure(accountID string, f Failure) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.accountFail[accountID] = f
}

// AddAccount registers an account (used by the seed and tests).
func (p *Provider) AddAccount(a bank.Account) {
	p.mu.Lock()
	defer p.mu.Unlock()
	cp := a
	p.accounts[a.ID] = &cp
}

// AddTransaction appends a historical transaction without moving the balance.
func (p *Provider) AddTransaction(t bank.Transaction) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.txns[t.AccountID] = append(p.txns[t.AccountID], t)
}

func failErr(f Failure) error {
	switch f {
	case FailTimeout:
		return bank.ErrTimeout
	case FailInsufficientFunds:
		return bank.ErrInsufficientFunds
	case FailBankDown:
		return bank.ErrBankUnavailable
	}
	return nil
}

func (p *Provider) bankErr(code string) error { return failErr(p.bankFailure[code]) }

func (p *Provider) GetAccounts(ctx context.Context, userID string) ([]bank.Account, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []bank.Account
	for _, a := range p.accounts {
		if a.UserID != userID {
			continue
		}
		if err := p.bankErr(a.BankCode); err != nil {
			return nil, fmt.Errorf("%s: %w", a.BankCode, err)
		}
		out = append(out, *a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (p *Provider) GetBalance(ctx context.Context, accountID string) (bank.Kobo, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	a, ok := p.accounts[accountID]
	if !ok {
		return 0, bank.ErrAccountNotFound
	}
	if err := p.bankErr(a.BankCode); err != nil {
		return 0, err
	}
	return a.BalanceKobo, nil
}

func (p *Provider) GetTransactions(ctx context.Context, accountID string, from, to time.Time) ([]bank.Transaction, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	a, ok := p.accounts[accountID]
	if !ok {
		return nil, bank.ErrAccountNotFound
	}
	if err := p.bankErr(a.BankCode); err != nil {
		return nil, err
	}
	var out []bank.Transaction
	for _, t := range p.txns[accountID] {
		if (t.PostedAt.Equal(from) || t.PostedAt.After(from)) && t.PostedAt.Before(to) {
			out = append(out, t)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PostedAt.After(out[j].PostedAt) })
	return out, nil
}

func (p *Provider) nextID(prefix string) string {
	p.seq++
	return fmt.Sprintf("%s_%06d", prefix, p.seq)
}

func (p *Provider) Transfer(ctx context.Context, req bank.TransferRequest) (bank.TransferResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if req.AmountKobo <= 0 {
		return bank.TransferResult{}, bank.ErrInvalidAmount
	}
	// Idempotent on reference: a retry returns the original result.
	if id, ok := p.byReference[req.Reference]; ok && req.Reference != "" {
		return p.transfers[id].res, nil
	}
	src, ok := p.accounts[req.FromAccountID]
	if !ok {
		return bank.TransferResult{}, bank.ErrAccountNotFound
	}
	if err := p.bankErr(src.BankCode); err != nil {
		return bank.TransferResult{}, err
	}
	if err := failErr(p.accountFail[src.ID]); err != nil {
		return bank.TransferResult{}, err
	}
	var dst *bank.Account
	if req.To.AccountID != "" {
		d, ok := p.accounts[req.To.AccountID]
		if !ok {
			return bank.TransferResult{}, bank.ErrAccountNotFound
		}
		if err := p.bankErr(d.BankCode); err != nil {
			return bank.TransferResult{}, err
		}
		dst = d
	}
	if src.BalanceKobo < req.AmountKobo {
		return bank.TransferResult{}, bank.ErrInsufficientFunds
	}
	now := p.now().UTC()
	tid := p.nextID("trf")
	src.BalanceKobo -= req.AmountKobo
	p.txns[src.ID] = append(p.txns[src.ID], bank.Transaction{
		ID: p.nextID("txn"), AccountID: src.ID, Direction: bank.Debit, AmountKobo: req.AmountKobo,
		Narration: "Transfer " + req.Reference, Counterparty: counterpartyName(req.To, dst), Reference: req.Reference, PostedAt: now, Verified: true,
	})
	toID := ""
	if dst != nil {
		dst.BalanceKobo += req.AmountKobo
		toID = dst.ID
		p.txns[dst.ID] = append(p.txns[dst.ID], bank.Transaction{
			ID: p.nextID("txn"), AccountID: dst.ID, Direction: bank.Credit, AmountKobo: req.AmountKobo,
			Narration: "Transfer " + req.Reference, Counterparty: src.AccountName, Reference: req.Reference, PostedAt: now, Verified: true,
		})
	}
	res := bank.TransferResult{TransferID: tid, Reference: req.Reference, AmountKobo: req.AmountKobo, CreatedAt: now}
	p.transfers[tid] = &transfer{res: res, from: src.ID, to: toID}
	if req.Reference != "" {
		p.byReference[req.Reference] = tid
	}
	return res, nil
}

func counterpartyName(d bank.Destination, a *bank.Account) string {
	if a != nil {
		return a.AccountName
	}
	if d.AccountName != "" {
		return d.AccountName
	}
	return d.AccountNumber
}

func (p *Provider) ReverseTransfer(ctx context.Context, transferID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	t, ok := p.transfers[transferID]
	if !ok {
		return bank.ErrTransferNotFound
	}
	if t.reversed {
		return bank.ErrAlreadyReversed
	}
	src := p.accounts[t.from]
	if err := p.bankErr(src.BankCode); err != nil {
		return err
	}
	if p.reverseDown[src.BankCode] {
		return bank.ErrBankUnavailable
	}
	var dst *bank.Account
	if t.to != "" {
		dst = p.accounts[t.to]
		if err := p.bankErr(dst.BankCode); err != nil {
			return err
		}
		if p.reverseDown[dst.BankCode] {
			return bank.ErrBankUnavailable
		}
		if dst.BalanceKobo < t.res.AmountKobo {
			return bank.ErrInsufficientFunds
		}
		dst.BalanceKobo -= t.res.AmountKobo
	}
	src.BalanceKobo += t.res.AmountKobo
	t.reversed = true
	now := p.now().UTC()
	p.txns[src.ID] = append(p.txns[src.ID], bank.Transaction{
		ID: p.nextID("txn"), AccountID: src.ID, Direction: bank.Credit, AmountKobo: t.res.AmountKobo,
		Narration: "Reversal " + t.res.Reference, Counterparty: "Apapo reversal", Reference: "rev_" + t.res.Reference, PostedAt: now, Verified: true,
	})
	if dst != nil {
		p.txns[dst.ID] = append(p.txns[dst.ID], bank.Transaction{
			ID: p.nextID("txn"), AccountID: dst.ID, Direction: bank.Debit, AmountKobo: t.res.AmountKobo,
			Narration: "Reversal " + t.res.Reference, Counterparty: "Apapo reversal", Reference: "rev_" + t.res.Reference, PostedAt: now, Verified: true,
		})
	}
	return nil
}
