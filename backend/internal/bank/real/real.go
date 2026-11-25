// Package real talks to a live bank HTTP API. It satisfies the same
// bank.Provider and bank.Linker interfaces as the mock, selected with PROVIDER=real.
//
// IMPORTANT: the request and response shapes below are an assumed REST shape
// until real bank API documentation is available. Change only the paths and
// structs in this file and the mapping at the bottom. Everything else in Apapo
// should remain unchanged.
package real

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
)

type Config struct {
	BaseURL string
	APIKey  string
	// Timeout for one HTTP call.
	Timeout time.Duration
	// ReadRetries is how many extra tries a read gets after a temporary failure.
	ReadRetries int
	// RetryDelay is the pause before the first retry; it doubles each time.
	RetryDelay time.Duration
	// Banks is the list shown in the bank picker.
	Banks []bank.BankInfo
}

type Provider struct {
	cfg  Config
	http *http.Client
}

var _ bank.Provider = (*Provider)(nil)
var _ bank.Linker = (*Provider)(nil)

func New(cfg Config) (*Provider, error) {
	if cfg.BaseURL == "" || cfg.APIKey == "" {
		return nil, errors.New("real provider needs BANK_API_URL and BANK_API_KEY")
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 8 * time.Second
	}
	if cfg.RetryDelay == 0 {
		cfg.RetryDelay = 200 * time.Millisecond
	}
	return &Provider{cfg: cfg, http: &http.Client{Timeout: cfg.Timeout}}, nil
}

func (p *Provider) Catalog() []bank.BankInfo { return p.cfg.Banks }

// apiError is the assumed error body: {"code": "...", "message": "..."}.
type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// do sends one request. idempotencyKey, when set, is sent so a bank can drop a repeat.
func (p *Provider) do(ctx context.Context, method, path string, query url.Values, body any, idempotencyKey string, out any) error {
	u := p.cfg.BaseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.cfg.APIKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	resp, err := p.http.Do(req)
	if err != nil {
		var ne net.Error
		if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout()) {
			return bank.ErrTimeout
		}
		return fmt.Errorf("%w: %v", bank.ErrBankUnavailable, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if out != nil {
			return json.Unmarshal(data, out)
		}
		return nil
	}
	var ae apiError
	json.Unmarshal(data, &ae)
	return mapError(resp.StatusCode, ae)
}

// mapError turns the bank's error into one of our typed errors.
func mapError(status int, ae apiError) error {
	switch {
	case ae.Code == "insufficient_funds":
		return bank.ErrInsufficientFunds
	case ae.Code == "account_not_found" || status == http.StatusNotFound && ae.Code != "transfer_not_found":
		return bank.ErrAccountNotFound
	case ae.Code == "transfer_not_found":
		return bank.ErrTransferNotFound
	case ae.Code == "already_reversed":
		return bank.ErrAlreadyReversed
	case status == http.StatusGatewayTimeout || status == http.StatusRequestTimeout:
		return bank.ErrTimeout
	case status >= 500 || status == http.StatusTooManyRequests:
		return bank.ErrBankUnavailable
	}
	return fmt.Errorf("bank: request refused (%d %s): %s", status, ae.Code, ae.Message)
}

// read retries temporary failures with a doubling pause. Writes never go through here.
func (p *Provider) read(ctx context.Context, path string, query url.Values, out any) error {
	delay := p.cfg.RetryDelay
	var err error
	for try := 0; try <= p.cfg.ReadRetries; try++ {
		err = p.do(ctx, http.MethodGet, path, query, nil, "", out)
		if err == nil || !(errors.Is(err, bank.ErrBankUnavailable) || errors.Is(err, bank.ErrTimeout)) {
			return err
		}
		if try < p.cfg.ReadRetries {
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return err
			}
			delay *= 2
		}
	}
	return err
}

// ---- assumed wire shapes (adapt these to a real bank API) ----

type wireAccount struct {
	ID            string `json:"id"`
	UserID        string `json:"user_id"`
	BankCode      string `json:"bank_code"`
	BankName      string `json:"bank_name"`
	AccountName   string `json:"account_name"`
	AccountNumber string `json:"account_number"`
	BalanceKobo   int64  `json:"balance_kobo"`
}

type wireTx struct {
	ID           string    `json:"id"`
	AccountID    string    `json:"account_id"`
	Direction    string    `json:"direction"`
	AmountKobo   int64     `json:"amount_kobo"`
	Narration    string    `json:"narration"`
	Counterparty string    `json:"counterparty"`
	Reference    string    `json:"reference"`
	PostedAt     time.Time `json:"posted_at"`
	Verified     bool      `json:"verified"`
}

type wireTransfer struct {
	TransferID string    `json:"transfer_id"`
	Reference  string    `json:"reference"`
	AmountKobo int64     `json:"amount_kobo"`
	CreatedAt  time.Time `json:"created_at"`
}

func toAccount(w wireAccount) bank.Account {
	return bank.Account{ID: w.ID, UserID: w.UserID, BankCode: w.BankCode, BankName: w.BankName,
		AccountName: w.AccountName, AccountNumber: w.AccountNumber, BalanceKobo: w.BalanceKobo}
}

// ---- bank.Provider ----

func (p *Provider) GetAccounts(ctx context.Context, userID string) ([]bank.Account, error) {
	var out struct {
		Accounts []wireAccount `json:"accounts"`
	}
	if err := p.read(ctx, "/accounts", url.Values{"user_id": {userID}}, &out); err != nil {
		return nil, err
	}
	accs := make([]bank.Account, len(out.Accounts))
	for i, a := range out.Accounts {
		accs[i] = toAccount(a)
	}
	return accs, nil
}

func (p *Provider) GetBalance(ctx context.Context, accountID string) (bank.Kobo, error) {
	var out struct {
		BalanceKobo int64 `json:"balance_kobo"`
	}
	err := p.read(ctx, "/accounts/"+url.PathEscape(accountID)+"/balance", nil, &out)
	return out.BalanceKobo, err
}

func (p *Provider) GetTransactions(ctx context.Context, accountID string, from, to time.Time) ([]bank.Transaction, error) {
	var out struct {
		Transactions []wireTx `json:"transactions"`
	}
	q := url.Values{"from": {from.UTC().Format(time.RFC3339)}, "to": {to.UTC().Format(time.RFC3339)}}
	if err := p.read(ctx, "/accounts/"+url.PathEscape(accountID)+"/transactions", q, &out); err != nil {
		return nil, err
	}
	txs := make([]bank.Transaction, len(out.Transactions))
	for i, t := range out.Transactions {
		txs[i] = bank.Transaction{ID: t.ID, AccountID: t.AccountID, Direction: bank.Direction(t.Direction), AmountKobo: t.AmountKobo,
			Narration: t.Narration, Counterparty: t.Counterparty, Reference: t.Reference, PostedAt: t.PostedAt, Verified: t.Verified}
	}
	return txs, nil
}

// Transfer is sent exactly once per call. The reference is the idempotency key, so the
// payments executor can safely repeat a timed out call; this method never retries by itself.
func (p *Provider) Transfer(ctx context.Context, req bank.TransferRequest) (bank.TransferResult, error) {
	if req.AmountKobo <= 0 {
		return bank.TransferResult{}, bank.ErrInvalidAmount
	}
	if req.Reference == "" {
		return bank.TransferResult{}, errors.New("real provider: a transfer needs a reference (idempotency key)")
	}
	var out wireTransfer
	body := map[string]any{"from_account_id": req.FromAccountID, "to": req.To, "amount_kobo": req.AmountKobo, "reference": req.Reference}
	if err := p.do(ctx, http.MethodPost, "/transfers", nil, body, req.Reference, &out); err != nil {
		return bank.TransferResult{}, err
	}
	return bank.TransferResult{TransferID: out.TransferID, Reference: out.Reference, AmountKobo: out.AmountKobo, CreatedAt: out.CreatedAt}, nil
}

func (p *Provider) ReverseTransfer(ctx context.Context, transferID string) error {
	return p.do(ctx, http.MethodPost, "/transfers/"+url.PathEscape(transferID)+"/reverse", nil, struct{}{}, "reverse-"+transferID, nil)
}

// ---- bank.Linker ----

func (p *Provider) LinkBank(ctx context.Context, userID, bankCode string) (bank.LinkResult, error) {
	var out struct {
		ConnectionID string `json:"connection_id"`
		AccessToken  string `json:"access_token"`
	}
	err := p.do(ctx, http.MethodPost, "/connections", nil, map[string]string{"user_id": userID, "bank_code": bankCode}, "link-"+userID+"-"+bankCode, &out)
	if err != nil {
		return bank.LinkResult{}, err
	}
	return bank.LinkResult{ProviderRef: out.ConnectionID, Token: out.AccessToken}, nil
}

func (p *Provider) AccountsAt(ctx context.Context, userID, bankCode string) ([]bank.Account, error) {
	var out struct {
		Accounts []wireAccount `json:"accounts"`
	}
	if err := p.read(ctx, "/accounts", url.Values{"user_id": {userID}, "bank_code": {bankCode}}, &out); err != nil {
		return nil, err
	}
	accs := make([]bank.Account, len(out.Accounts))
	for i, a := range out.Accounts {
		accs[i] = toAccount(a)
	}
	return accs, nil
}

func (p *Provider) Unlink(ctx context.Context, userID, bankCode string) error {
	return p.do(ctx, http.MethodDelete, "/connections", url.Values{"user_id": {userID}, "bank_code": {bankCode}}, nil, "", nil)
}
