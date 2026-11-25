package mock

import (
	"context"
	"fmt"
	"sort"

	"github.com/Mykelsown/apapo/backend/internal/bank"
)

var _ bank.Linker = (*Provider)(nil)

// LinkBank connects a user to a mock bank. A user who has no account there yet gets a
// seeded one, so every new sign up has realistic data to work with.
func (p *Provider) LinkBank(ctx context.Context, userID, bankCode string) (bank.LinkResult, error) {
	if bankIndex(bankCode) < 0 {
		return bank.LinkResult{}, bank.ErrUnsupportedBank
	}
	p.mu.Lock()
	err := p.bankErr(bankCode)
	p.mu.Unlock()
	if err != nil {
		return bank.LinkResult{}, err
	}
	p.SeedBank(userID, bankCode, fmt.Sprintf("acc_%s_%s", bankCode, userID))
	p.mu.Lock()
	defer p.mu.Unlock()
	p.seq++
	return bank.LinkResult{ProviderRef: fmt.Sprintf("conn_%s_%06d", bankCode, p.seq), Token: fmt.Sprintf("mocktok_%s_%06d", bankCode, p.seq)}, nil
}

func (p *Provider) AccountsAt(ctx context.Context, userID, bankCode string) ([]bank.Account, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.bankErr(bankCode); err != nil {
		return nil, fmt.Errorf("%s: %w", bankCode, err)
	}
	var out []bank.Account
	for _, a := range p.accounts {
		if a.UserID == userID && a.BankCode == bankCode {
			out = append(out, *a)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (p *Provider) Unlink(ctx context.Context, userID, bankCode string) error { return nil }

// Catalog is the list the link screen shows: four working banks and three coming soon.
func Catalog() []bank.BankInfo {
	var out []bank.BankInfo
	for _, b := range Banks {
		out = append(out, bank.BankInfo{Code: b.Code, Name: b.Name, Supported: true})
	}
	return append(out,
		bank.BankInfo{Code: "lagoon", Name: "Lagoon Bank", Supported: false},
		bank.BankInfo{Code: "sahel", Name: "Sahel Trust", Supported: false},
		bank.BankInfo{Code: "palm", Name: "Palm MFB", Supported: false},
	)
}

// SimulateCredit puts money into an account as an incoming payment from someone else.
// verified false makes it look like a pending or reversible credit (the kind scammers
// rely on). Demo and tests only.
func (p *Provider) SimulateCredit(accountID string, amount bank.Kobo, sender string, verified bool) (bank.Transaction, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	a, ok := p.accounts[accountID]
	if !ok {
		return bank.Transaction{}, bank.ErrAccountNotFound
	}
	if amount <= 0 {
		return bank.Transaction{}, bank.ErrInvalidAmount
	}
	if err := p.bankErr(a.BankCode); err != nil {
		return bank.Transaction{}, err
	}
	a.BalanceKobo += amount
	t := bank.Transaction{
		ID: p.nextID("txn"), AccountID: accountID, Direction: bank.Credit, AmountKobo: amount,
		Narration: "NIP CREDIT FROM " + sender, Counterparty: sender, Reference: p.nextID("nip"),
		PostedAt: p.now().UTC(), Verified: verified,
	}
	p.txns[accountID] = append(p.txns[accountID], t)
	return t, nil
}

// SimulateP2PCredit creates a confirmed incoming P2P credit with an explicit
// provider reference. It is for demo and test-only credit verification.
func (p *Provider) SimulateP2PCredit(accountID string, amount bank.Kobo, sender, reference string) (bank.Transaction, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	a, ok := p.accounts[accountID]
	if !ok {
		return bank.Transaction{}, bank.ErrAccountNotFound
	}
	if amount <= 0 {
		return bank.Transaction{}, bank.ErrInvalidAmount
	}
	if err := p.bankErr(a.BankCode); err != nil {
		return bank.Transaction{}, err
	}
	a.BalanceKobo += amount
	t := bank.Transaction{
		ID: p.nextID("txn"), AccountID: accountID, Direction: bank.Credit, AmountKobo: amount,
		Narration: "APAPO P2P FROM " + sender, Counterparty: sender, Reference: reference,
		PostedAt: p.now().UTC(), Verified: true,
	}
	p.txns[accountID] = append(p.txns[accountID], t)
	return t, nil
}

func (p *Provider) SimulateCreditWithReference(accountID string, amount bank.Kobo, sender, reference string) (bank.Transaction, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	a, ok := p.accounts[accountID]
	if !ok {
		return bank.Transaction{}, bank.ErrAccountNotFound
	}
	if amount <= 0 {
		return bank.Transaction{}, bank.ErrInvalidAmount
	}
	if err := p.bankErr(a.BankCode); err != nil {
		return bank.Transaction{}, err
	}
	a.BalanceKobo += amount
	t := bank.Transaction{
		ID: p.nextID("txn"), AccountID: accountID, Direction: bank.Credit, AmountKobo: amount,
		Narration: "APAPO MOVEMENT", Counterparty: sender, Reference: reference,
		PostedAt: p.now().UTC(), Verified: true,
	}
	p.txns[accountID] = append(p.txns[accountID], t)
	return t, nil
}
