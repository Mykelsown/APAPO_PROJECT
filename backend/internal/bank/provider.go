// Package bank defines the seam between Apapo and any bank. Everything that
// touches money goes through Provider, so the mock and real implementations
// are interchangeable.
package bank

import (
	"context"
	"errors"
	"time"
)

// All money is integer kobo. Never floats.
type Kobo = int64

type Direction string

const (
	Credit Direction = "credit"
	Debit  Direction = "debit"
)

type Account struct {
	ID            string `json:"id"`
	UserID        string `json:"user_id"`
	BankCode      string `json:"bank_code"`
	BankName      string `json:"bank_name"`
	AccountName   string `json:"account_name"`
	AccountNumber string `json:"account_number"` // full number; mask before sending to clients
	BalanceKobo   Kobo   `json:"balance_kobo"`
}

type Transaction struct {
	ID           string    `json:"id"`
	AccountID    string    `json:"account_id"`
	Direction    Direction `json:"direction"`
	AmountKobo   Kobo      `json:"amount_kobo"`
	Narration    string    `json:"narration"`
	Counterparty string    `json:"counterparty"`
	Reference    string    `json:"reference"`
	PostedAt     time.Time `json:"posted_at"`
	// Verified is the bank's statement that the entry is final and not reversible.
	// A credit that is not verified must never trigger a split.
	Verified bool `json:"verified"`
}

// Destination is where a transfer goes. Either an account we know (AccountID)
// or an external account (BankCode + AccountNumber).
type Destination struct {
	AccountID     string `json:"account_id,omitempty"`
	BankCode      string `json:"bank_code,omitempty"`
	AccountNumber string `json:"account_number,omitempty"`
	AccountName   string `json:"account_name,omitempty"`
}

type TransferRequest struct {
	FromAccountID string
	To            Destination
	AmountKobo    Kobo
	// Reference doubles as the idempotency key: the same reference never moves money twice.
	Reference string
}

type TransferResult struct {
	TransferID string    `json:"transfer_id"`
	Reference  string    `json:"reference"`
	AmountKobo Kobo      `json:"amount_kobo"`
	CreatedAt  time.Time `json:"created_at"`
}

// Typed errors. Callers branch on these with errors.Is.
var (
	ErrTimeout           = errors.New("bank: request timed out")
	ErrInsufficientFunds = errors.New("bank: insufficient funds")
	ErrBankUnavailable   = errors.New("bank: bank unavailable")
	ErrAccountNotFound   = errors.New("bank: account not found")
	ErrTransferNotFound  = errors.New("bank: transfer not found")
	ErrAlreadyReversed   = errors.New("bank: transfer already reversed")
	ErrInvalidAmount     = errors.New("bank: amount must be positive")
)

type Provider interface {
	GetAccounts(ctx context.Context, userID string) ([]Account, error)
	GetBalance(ctx context.Context, accountID string) (Kobo, error)
	GetTransactions(ctx context.Context, accountID string, from, to time.Time) ([]Transaction, error)
	Transfer(ctx context.Context, req TransferRequest) (TransferResult, error)
	ReverseTransfer(ctx context.Context, transferID string) error
}
