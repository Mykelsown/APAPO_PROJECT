// Package safesend scores a recipient before money leaves, takes scam reports, and
// warns when a pending transfer looks like the "I sent it, check your account" trick.
package safesend

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
)

const (
	TierLow     = "low"
	TierUnknown = "unknown"
	TierHigh    = "high"

	MinReportersForHigh = 3
	MaxReportsPerDay    = 5
)

var (
	ErrEvidenceRequired = errors.New("evidence reference required")
	ErrReportLimit      = errors.New("daily report limit reached")
)

// Recipient is who the money is going to.
type Recipient struct {
	BankCode, AccountNumber, AccountName string
}

// Payment is the slice of payment history the checker needs.
type Payment struct {
	Recipient  Recipient
	AmountKobo int64
	At         time.Time
	Successful bool
}

// Result is what the app shows before the user confirms.
type Result struct {
	Tier    string   `json:"tier"`
	Reasons []string `json:"reasons"`
	Flags   []string `json:"flags"`
}

type Service struct {
	Store Store
	Salt  []byte
	Now   func() time.Time
	// ResolveName looks the account name up at the bank (name enquiry). Optional.
	ResolveName func(ctx context.Context, bankCode, accountNumber string) (string, bool)
}

// Hash is a salted, keyed hash of bank and account. Raw recipients are never stored.
func (s *Service) Hash(bankCode, account string) string {
	m := hmac.New(sha256.New, s.Salt)
	m.Write([]byte(strings.ToLower(bankCode) + "|" + account))
	return hex.EncodeToString(m.Sum(nil))
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func median(v []int64) int64 {
	if len(v) == 0 {
		return 0
	}
	c := append([]int64(nil), v...)
	sort.Slice(c, func(i, j int) bool { return c[i] < c[j] })
	return c[len(c)/2]
}

func normName(n string) []string {
	f := strings.Fields(strings.ToLower(strings.NewReplacer(".", " ", ",", " ", "-", " ").Replace(n)))
	return f
}

// namesMatch is true when every word of the shorter name appears in the longer one.
func namesMatch(a, b string) bool {
	x, y := normName(a), normName(b)
	if len(x) == 0 || len(y) == 0 {
		return false
	}
	if len(x) > len(y) {
		x, y = y, x
	}
	set := map[string]bool{}
	for _, w := range y {
		set[w] = true
	}
	for _, w := range x {
		if !set[w] {
			return false
		}
	}
	return true
}

// Check scores a recipient. history is the user's recent payments, newest first.
func (s *Service) Check(ctx context.Context, userID string, to Recipient, amountKobo int64, history []Payment) (Result, error) {
	res := Result{Tier: TierUnknown, Reasons: []string{}, Flags: []string{}}
	hash := s.Hash(to.BankCode, to.AccountNumber)
	n, err := s.Store.Reporters(ctx, hash)
	if err != nil {
		return res, err
	}
	if n >= MinReportersForHigh {
		res.Tier = TierHigh
		res.Reasons = append(res.Reasons, "reported_by_multiple_people")
		res.Flags = append(res.Flags, "reported_recipient")
	} else if n > 0 {
		res.Reasons = append(res.Reasons, "some_reports_not_enough_to_confirm")
	}

	// Has this user successfully paid this recipient before?
	known := false
	var amounts []int64
	for i, p := range history {
		if !p.Successful {
			continue
		}
		if len(amounts) < 20 {
			amounts = append(amounts, p.AmountKobo)
		}
		if p.Recipient.BankCode == to.BankCode && p.Recipient.AccountNumber == to.AccountNumber {
			known = true
		}
		_ = i
	}
	nameChecked, nameOK := false, false
	if s.ResolveName != nil {
		if real, ok := s.ResolveName(ctx, to.BankCode, to.AccountNumber); ok {
			nameChecked = true
			nameOK = to.AccountName == "" || namesMatch(real, to.AccountName)
			if !nameOK {
				res.Flags = append(res.Flags, "name_mismatch")
				res.Reasons = append(res.Reasons, "name_does_not_match_bank_record")
			}
		}
	}
	if !known {
		res.Flags = append(res.Flags, "new_beneficiary")
		res.Reasons = append(res.Reasons, "first_payment_to_this_recipient")
	}
	if len(amounts) >= 3 {
		if m := median(amounts); m > 0 && amountKobo >= 5*m {
			res.Flags = append(res.Flags, "unusual_amount")
			res.Reasons = append(res.Reasons, "amount_far_above_your_usual_payments")
		}
	}
	now := s.now()
	for _, p := range history {
		if p.Recipient.BankCode == to.BankCode && p.Recipient.AccountNumber == to.AccountNumber &&
			p.AmountKobo == amountKobo && now.Sub(p.At) < 10*time.Minute && now.After(p.At) {
			res.Flags = append(res.Flags, "possible_duplicate")
			res.Reasons = append(res.Reasons, "same_payment_sent_minutes_ago")
			break
		}
	}
	if res.Tier != TierHigh && n == 0 && len(res.Flags) == 0 && (known || (nameChecked && nameOK)) {
		res.Tier = TierLow
		res.Reasons = append(res.Reasons, "no_reports_and_no_warning_signs")
	}
	return res, nil
}

// Report records a scam report. Evidence (for example a transaction reference or
// screenshot id) is mandatory, so reports cannot be thrown in without something behind them.
func (s *Service) Report(ctx context.Context, reporter string, to Recipient, evidence string) (created bool, err error) {
	evidence = strings.TrimSpace(evidence)
	if len(evidence) < 4 {
		return false, ErrEvidenceRequired
	}
	n, err := s.Store.ReportsSince(ctx, reporter, s.now().Add(-24*time.Hour))
	if err != nil {
		return false, err
	}
	if n >= MaxReportsPerDay {
		return false, ErrReportLimit
	}
	b := make([]byte, 8)
	rand.Read(b)
	return s.Store.AddReport(ctx, "rep_"+hex.EncodeToString(b), s.Hash(to.BankCode, to.AccountNumber), reporter, evidence, s.now())
}

// SeedFlagged files three reports from made up reporters, enough to reach the high tier.
func (s *Service) SeedFlagged(ctx context.Context, to Recipient) {
	for _, r := range []string{"seed_reporter_1", "seed_reporter_2", "seed_reporter_3"} {
		s.Store.AddReport(ctx, "rep_seed_"+r+to.AccountNumber, s.Hash(to.BankCode, to.AccountNumber), r, "seed-evidence", s.now())
	}
}

// ShieldAlert is shown when a pending transfer matches a credit the bank has not confirmed.
type ShieldAlert struct {
	CreditID    string    `json:"credit_id"`
	AccountID   string    `json:"account_id"`
	AmountKobo  int64     `json:"amount_kobo"`
	Sender      string    `json:"sender"`
	ReceivedAt  time.Time `json:"received_at"`
	PendingKobo int64     `json:"pending_kobo"`
	Message     string    `json:"message"`
}

// Shield looks for an unverified credit from the last 24 hours that a pending transfer
// roughly matches (within 10 percent). Money that is not verified can be reversed by the bank.
func isApapoMovement(reference string) bool {
	for _, prefix := range []string{"pay_", "rev_", "sr_", "p2p_"} {
		if strings.HasPrefix(reference, prefix) {
			return true
		}
	}
	return false
}

func (s *Service) Shield(ctx context.Context, userID string, credits []bank.Transaction, pendingKobo int64) (*ShieldAlert, error) {
	if pendingKobo <= 0 {
		return nil, nil
	}
	now := s.now()
	for _, c := range credits {
		if c.Direction != bank.Credit || c.Verified || isApapoMovement(c.Reference) || now.Sub(c.PostedAt) > 24*time.Hour {
			continue
		}
		diff := pendingKobo - c.AmountKobo
		if diff < 0 {
			diff = -diff
		}
		if diff*10 > c.AmountKobo {
			continue
		}
		if d, _ := s.Store.Dismissed(ctx, userID, c.ID); d {
			continue
		}
		return &ShieldAlert{
			CreditID: c.ID, AccountID: c.AccountID, AmountKobo: c.AmountKobo, Sender: c.Counterparty, ReceivedAt: c.PostedAt, PendingKobo: pendingKobo,
			Message: "This money has not been confirmed by the bank yet. Wait for confirmation before sending it on.",
		}, nil
	}
	return nil, nil
}

func (s *Service) Dismiss(ctx context.Context, userID, creditID string) error {
	return s.Store.Dismiss(ctx, userID, creditID, s.now())
}
