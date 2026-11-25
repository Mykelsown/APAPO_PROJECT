package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/auth"
	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/limits"
	"github.com/Mykelsown/apapo/backend/internal/payments"
	"github.com/Mykelsown/apapo/backend/internal/planner"
)

// Mock fee schedule until the real provider reports fees (B9). Kobo per leg.
var defaultFeeKobo = map[string]int64{"apex": 1000, "delta": 500, "savanna": 1000, "harbor": 2500}

const defaultFee = 1000

type previewRequest struct {
	AmountKobo int64 `json:"amount_kobo"`
	Recipient  struct {
		BankCode      string `json:"bank_code"`
		AccountNumber string `json:"account_number"`
		AccountName   string `json:"account_name"`
		ApapoPhone    string `json:"apapo_phone"`
		// Display fields the frontend keeps on a chosen recipient and sends back.
		// They are accepted and ignored: the server works out the type and the masked
		// name itself and never trusts these.
		RecipientType     string `json:"recipient_type,omitempty"`
		MaskedDisplayName string `json:"masked_display_name,omitempty"`
	} `json:"recipient"`
	Strategy       string `json:"strategy"`
	MinBalanceKobo int64  `json:"min_balance_kobo"`
	MaxLegs        int    `json:"max_legs"`
	PIN            string `json:"pin,omitempty"`
}

type previewLeg struct {
	AccountID     string `json:"account_id"`
	BankCode      string `json:"bank_code"`
	BankName      string `json:"bank_name"`
	AccountNumber string `json:"account_number"`
	AmountKobo    int64  `json:"amount_kobo"`
	FeeKobo       int64  `json:"fee_kobo"`
}

type riskResult struct {
	Tier    string   `json:"tier"`
	Reasons []string `json:"reasons"`
}

var tenDigits = regexp.MustCompile(`^\d{10}$`)

func (s *Server) resolveApapoRecipient(w http.ResponseWriter, r *http.Request, req *previewRequest) bool {
	if req.Recipient.ApapoPhone == "" {
		return true
	}
	phone, err := auth.NormalizePhone(req.Recipient.ApapoPhone)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_phone", "Enter a Nigerian phone number.", nil)
		return false
	}
	sender := userFrom(r.Context())
	if phone == sender.Phone {
		writeError(w, http.StatusBadRequest, "self_send", "You cannot send money to yourself.", nil)
		return false
	}
	recipient, err := s.deps.Auth.Store.GetUserByPhone(r.Context(), phone)
	if err != nil || !recipient.Onboarded() || recipient.ReceivingAccountID == "" {
		writeError(w, http.StatusNotFound, "not_found", "Apapo recipient not found.", nil)
		return false
	}
	accs, _, _, err := s.userAccounts(r.Context(), recipient.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Something went wrong.", nil)
		return false
	}
	for _, acc := range accs {
		if acc.ID == recipient.ReceivingAccountID {
			req.Recipient.BankCode = acc.BankCode
			req.Recipient.AccountNumber = acc.AccountNumber
			req.Recipient.AccountName = recipient.DisplayName
			req.Recipient.ApapoPhone = phone
			return true
		}
	}
	writeError(w, http.StatusNotFound, "not_found", "Apapo recipient not found.", nil)
	return false
}

// planFromRequest parses and validates a preview or execute body, reads the user's
// accounts and runs the planner. On failure it has already written the response.
func (s *Server) planFromRequest(w http.ResponseWriter, r *http.Request) (previewRequest, planner.Plan, map[string]bank.Account, bool) {
	req, ok := parseRequest(w, r)
	if !ok {
		return req, planner.Plan{}, nil, false
	}
	return s.planFor(w, r, req)
}

// parseRequest decodes and validates the body without touching any bank.
func parseRequest(w http.ResponseWriter, r *http.Request) (previewRequest, bool) {
	var req previewRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "The request body is not valid.", nil)
		return req, false
	}
	if req.AmountKobo <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_amount", "Amount must be greater than zero.", nil)
		return req, false
	}
	apapo := req.Recipient.ApapoPhone != ""
	outside := req.Recipient.BankCode != "" || req.Recipient.AccountNumber != ""
	if apapo == outside {
		writeError(w, http.StatusBadRequest, "invalid_recipient", "Recipient needs a bank and a 10 digit account number.", nil)
		return req, false
	}
	if !apapo && (req.Recipient.BankCode == "" || !tenDigits.MatchString(req.Recipient.AccountNumber)) {
		writeError(w, http.StatusBadRequest, "invalid_recipient", "Recipient needs a bank and a 10 digit account number.", nil)
		return req, false
	}
	if req.MinBalanceKobo < 0 || req.MaxLegs < 0 || req.MaxLegs > 8 {
		writeError(w, http.StatusBadRequest, "invalid_rules", "Minimum balance or leg limit is out of range.", nil)
		return req, false
	}
	return req, true
}

// planFor reads the user's accounts and runs the planner.
func (s *Server) planFor(w http.ResponseWriter, r *http.Request, req previewRequest) (previewRequest, planner.Plan, map[string]bank.Account, bool) {

	// Only accounts at active links are used, so revoked banks never take part.
	// A bank that is down is skipped; if what is left cannot cover it, the user is told.
	accounts, _, _, err := s.userAccounts(r.Context(), s.currentUserID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Something went wrong.", nil)
		return req, planner.Plan{}, nil, false
	}
	byID := map[string]bank.Account{}
	var in []planner.Account
	for _, a := range accounts {
		byID[a.ID] = a
		fee, ok := defaultFeeKobo[a.BankCode]
		if !ok {
			fee = defaultFee
		}
		in = append(in, planner.Account{ID: a.ID, BankCode: a.BankCode, BalanceKobo: a.BalanceKobo, FeeKobo: fee})
	}

	plan, err := planner.Make(req.AmountKobo, in, planner.Rules{
		Strategy:       planner.Strategy(req.Strategy),
		MinBalanceKobo: req.MinBalanceKobo,
		MaxLegs:        req.MaxLegs,
	})
	if err != nil {
		var ins *planner.InsufficientFundsError
		switch {
		case errors.As(err, &ins):
			writeError(w, http.StatusUnprocessableEntity, "insufficient_funds",
				"Your linked accounts cannot cover this payment.",
				map[string]any{"spendable_kobo": ins.SpendableKobo, "shortfall_kobo": ins.ShortfallKobo})
		case errors.Is(err, planner.ErrTooManyLegs):
			writeError(w, http.StatusUnprocessableEntity, "too_many_legs", "This payment needs more accounts than the leg limit allows.", nil)
		case errors.Is(err, planner.ErrBadStrategy):
			writeError(w, http.StatusBadRequest, "invalid_strategy", "Strategy must be largest_first or lowest_fee.", nil)
		default:
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error(), nil)
		}
		return req, planner.Plan{}, nil, false
	}
	return req, plan, byID, true
}

func (s *Server) splitPayPreview(w http.ResponseWriter, r *http.Request) {
	req, ok := parseRequest(w, r)
	if ok {
		ok = s.resolveApapoRecipient(w, r, &req)
	}
	if !ok || !s.checkLimit(w, r, req.AmountKobo) {
		return
	}
	req, plan, byID, ok := s.planFor(w, r, req)
	if !ok {
		return
	}
	risk := s.riskFor(r.Context(), s.currentUserID(r), req)
	legs := make([]previewLeg, 0, len(plan.Legs))
	for _, l := range plan.Legs {
		a := byID[l.AccountID]
		legs = append(legs, previewLeg{
			AccountID: a.ID, BankCode: a.BankCode, BankName: a.BankName,
			AccountNumber: maskAccount(a.AccountNumber), AmountKobo: l.AmountKobo, FeeKobo: l.FeeKobo,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"legs":             legs,
		"amount_kobo":      plan.AmountKobo,
		"total_fee_kobo":   plan.TotalFeeKobo,
		"total_debit_kobo": plan.TotalDebitKobo,
		"risk":             riskResult{Tier: risk.Tier, Reasons: risk.Reasons},
		"flags":            risk.Flags,
		"recipient": func() map[string]any {
			if req.Recipient.ApapoPhone != "" {
				recipient, _ := s.deps.Auth.Store.GetUserByPhone(r.Context(), req.Recipient.ApapoPhone)
				return map[string]any{"recipient_type": "apapo", "masked_display_name": maskDisplayName(recipient.DisplayName)}
			}
			return map[string]any{"recipient_type": "outside"}
		}(),
	})
}

type paymentLeg struct {
	AccountID  string `json:"account_id"`
	BankCode   string `json:"bank_code"`
	AmountKobo int64  `json:"amount_kobo"`
	FeeKobo    int64  `json:"fee_kobo"`
	State      string `json:"state"`
	Error      string `json:"error,omitempty"`
}

func formatOptionalTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

func paymentJSON(p *payments.Payment) map[string]any {
	legs := make([]paymentLeg, 0, len(p.Legs))
	for _, l := range p.Legs {
		legs = append(legs, paymentLeg{l.AccountID, l.BankCode, l.AmountKobo, l.FeeKobo, string(l.State), l.Error})
	}
	recipient := map[string]any{
		"bank_code": p.Recipient.BankCode, "account_number": maskAccount(p.Recipient.AccountNumber), "account_name": p.Recipient.AccountName,
	}
	if p.Recipient.RecipientType == "apapo" {
		recipient = map[string]any{
			"recipient_type":      "apapo",
			"masked_display_name": p.Recipient.ApapoMaskedName,
		}
	}
	return map[string]any{
		"id":                       p.ID,
		"state":                    p.State,
		"amount_kobo":              p.AmountKobo,
		"total_fee_kobo":           p.FeeKobo,
		"recipient":                recipient,
		"message":                  p.Message,
		"legs":                     legs,
		"created_at":               p.CreatedAt.Format(time.RFC3339),
		"updated_at":               p.UpdatedAt.Format(time.RFC3339),
		"reversal_attempt_count":   p.ReversalAttempts,
		"next_reversal_retry_at":   formatOptionalTime(p.NextReversalRetry),
		"last_reversal_attempt_at": formatOptionalTime(p.LastReversalAttempt),
		"human_review":             p.HumanReview,
	}
}

func (s *Server) splitPayExecute(w http.ResponseWriter, r *http.Request) {
	key := r.Header.Get("Idempotency-Key")
	if len(key) < 8 || len(key) > 100 {
		writeError(w, http.StatusBadRequest, "missing_idempotency_key", "Send an Idempotency-Key header of 8 to 100 characters.", nil)
		return
	}
	req, ok := parseRequest(w, r)
	if !ok {
		return
	}
	uid := s.currentUserID(r)
	// Every payment needs the PIN, even a repeat of an earlier request.
	if err := s.deps.Auth.CheckPIN(r.Context(), uid, req.PIN); err != nil {
		pinError(w, err)
		return
	}
	if ok = s.resolveApapoRecipient(w, r, &req); !ok {
		return
	}
	// A retry of a known key is answered before planning, because balances have
	// moved since the first attempt and the plan would no longer fit.
	if prev, err := s.deps.Store.GetByKey(r.Context(), uid, key); err == nil {
		if prev.AmountKobo != req.AmountKobo || prev.Recipient.AccountNumber != req.Recipient.AccountNumber || prev.Recipient.BankCode != req.Recipient.BankCode ||
			prev.Recipient.ApapoPhone != req.Recipient.ApapoPhone {
			writeError(w, http.StatusConflict, "idempotency_conflict", "This key was already used for a different payment.", nil)
			return
		}
		writeJSON(w, http.StatusOK, paymentJSON(prev))
		return
	}
	// A quick check before planning, so an over limit payment never touches a bank.
	if !s.checkLimit(w, r, req.AmountKobo) {
		return
	}
	req, plan, _, ok := s.planFor(w, r, req)
	if !ok {
		return
	}
	var p *payments.Payment
	var created bool
	start := func(ctx context.Context) (err error) {
		recipientType := ""
		apapoPhone := ""
		apapoUserID := ""
		apapoMaskedName := ""
		receivingAccount := ""
		if req.Recipient.ApapoPhone != "" {
			recipientType = "apapo"
			apapoPhone = req.Recipient.ApapoPhone
			if recipient, err := s.deps.Auth.Store.GetUserByPhone(ctx, apapoPhone); err == nil {
				apapoUserID = recipient.ID
				apapoMaskedName = maskDisplayName(recipient.DisplayName)
				receivingAccount = recipient.ReceivingAccountID
			}
		}
		p, created, err = s.deps.Executor.Start(ctx, payments.StartInput{
			UserID: uid, IdempotencyKey: key, Plan: plan,
			Recipient: payments.Recipient{
				BankCode: req.Recipient.BankCode, AccountNumber: req.Recipient.AccountNumber,
				AccountName: req.Recipient.AccountName, ApapoPhone: apapoPhone,
				ApapoUserID: apapoUserID, ApapoMaskedName: apapoMaskedName,
				ReceivingAccount: receivingAccount, RecipientType: recipientType,
			},
		})
		return err
	}
	var err error
	if s.deps.Limits != nil {
		// The binding check: limit and payment creation are one step per user, so two
		// payments fired at the same instant cannot both squeeze under the limit.
		err = s.deps.Limits.Reserve(r.Context(), uid, req.AmountKobo, start)
		var ex *limits.ExceededError
		if errors.As(err, &ex) {
			// A twin request with the same key may have won the race; answer with its payment.
			if prev, gerr := s.deps.Store.GetByKey(r.Context(), uid, key); gerr == nil {
				p, created, err = prev, false, nil
				if prev.AmountKobo != req.AmountKobo || prev.Recipient.AccountNumber != req.Recipient.AccountNumber || prev.Recipient.BankCode != req.Recipient.BankCode ||
					prev.Recipient.ApapoPhone != req.Recipient.ApapoPhone {
					err = payments.ErrIdempotencyConflict
				}
			} else {
				s.limitOK(w, err)
				return
			}
		}
	} else {
		err = start(r.Context())
	}
	switch {
	case errors.Is(err, payments.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "idempotency_conflict", "This key was already used for a different payment.", nil)
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal_error", "Something went wrong. Nothing was charged.", nil)
		return
	}
	if !created {
		writeJSON(w, http.StatusOK, paymentJSON(p)) // a repeat gets the original payment
		return
	}
	id := p.ID
	s.async(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		s.deps.Executor.Run(ctx, uid, id)
	})
	writeJSON(w, http.StatusAccepted, paymentJSON(p))
}

func (s *Server) splitPayStatus(w http.ResponseWriter, r *http.Request) {
	p, err := s.deps.Store.Get(r.Context(), s.currentUserID(r), r.PathValue("id"))
	if errors.Is(err, payments.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Payment not found.", nil)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Something went wrong.", nil)
		return
	}
	writeJSON(w, http.StatusOK, paymentJSON(p))
}

func (s *Server) listPayments(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 100 {
			writeError(w, 400, "invalid_query", "limit must be between 1 and 100.", nil)
			return
		}
		limit = n
	}
	before := r.URL.Query().Get("before")
	payments, err := s.deps.Store.ListSent(r.Context(), s.currentUserID(r), limit+1, before)
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	var next any
	if len(payments) > limit {
		next = payments[limit-1].ID
		payments = payments[:limit]
	}
	out := make([]map[string]any, 0, len(payments))
	for _, p := range payments {
		out = append(out, map[string]any{
			"id": p.ID, "state": p.State, "amount_kobo": p.AmountKobo,
			"fee_kobo": p.FeeKobo, "recipient": paymentRecipientJSON(p.Recipient),
			"created_at": p.CreatedAt.Format(time.RFC3339), "updated_at": p.UpdatedAt.Format(time.RFC3339),
		})
	}
	writeJSON(w, 200, map[string]any{"payments": out, "next_before": next})
}

func paymentRecipientJSON(rec payments.Recipient) map[string]any {
	if rec.RecipientType == "apapo" {
		return map[string]any{
			"recipient_type":      "apapo",
			"masked_display_name": rec.ApapoMaskedName,
		}
	}
	return map[string]any{
		"recipient_type": "outside",
		"bank_code":      rec.BankCode,
		"account_number": maskAccount(rec.AccountNumber),
		"account_name":   rec.AccountName,
	}
}

func (s *Server) recentRecipients(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 50 {
			writeError(w, 400, "invalid_query", "limit must be between 1 and 50.", nil)
			return
		}
		limit = n
	}
	payments, err := s.deps.Store.ListSent(r.Context(), s.currentUserID(r), 200, "")
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	out := make([]map[string]any, 0, limit)
	seen := map[string]bool{}
	for _, p := range payments {
		rec := p.Recipient
		key := rec.RecipientType + "|" + rec.ApapoPhone + "|" + rec.BankCode + "|" + rec.AccountNumber
		if rec.RecipientType == "" {
			key = "outside|" + rec.BankCode + "|" + rec.AccountNumber
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, paymentRecipientJSON(rec))
		if len(out) >= limit {
			break
		}
	}
	writeJSON(w, 200, map[string]any{"recipients": out})
}
