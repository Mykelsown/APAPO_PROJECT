package bank

import (
	"context"
	"errors"
)

var ErrUnsupportedBank = errors.New("bank: bank not supported")

type LinkResult struct {
	ProviderRef string // the bank's id for this connection
	Token       string // credential for later calls; stored encrypted, never shown
}

// Linker is the open banking side of a provider: connect a user's bank, then read
// that bank's accounts. The mock and the real provider both implement it.
type Linker interface {
	LinkBank(ctx context.Context, userID, bankCode string) (LinkResult, error)
	// AccountsAt lists one user's accounts at one bank, so one slow bank never blocks the rest.
	AccountsAt(ctx context.Context, userID, bankCode string) ([]Account, error)
	Unlink(ctx context.Context, userID, bankCode string) error
}

// BankInfo is one row of the bank picker.
type BankInfo struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	Supported bool   `json:"supported"`
}
