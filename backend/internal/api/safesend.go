package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/safesend"
)

// history converts the user's recent payments for the risk checker.
func (s *Server) history(ctx context.Context, userID string) []safesend.Payment {
	recent, err := s.deps.Store.Recent(ctx, userID, 40)
	if err != nil {
		return nil
	}
	out := make([]safesend.Payment, 0, len(recent))
	for _, p := range recent {
		out = append(out, safesend.Payment{
			Recipient:  safesend.Recipient{BankCode: p.Recipient.BankCode, AccountNumber: p.Recipient.AccountNumber, AccountName: p.Recipient.AccountName},
			AmountKobo: p.AmountKobo, At: p.CreatedAt, Successful: string(p.State) == "completed",
		})
	}
	return out
}

// riskFor scores a recipient. With Safe Send off it returns the honest default.
func (s *Server) riskFor(ctx context.Context, userID string, req previewRequest) safesend.Result {
	if s.deps.SafeSend == nil {
		return safesend.Result{Tier: safesend.TierUnknown, Reasons: []string{}, Flags: []string{}}
	}
	res, err := s.deps.SafeSend.Check(ctx, userID,
		safesend.Recipient{BankCode: req.Recipient.BankCode, AccountNumber: req.Recipient.AccountNumber, AccountName: req.Recipient.AccountName},
		req.AmountKobo, s.history(ctx, userID))
	if err != nil {
		return safesend.Result{Tier: safesend.TierUnknown, Reasons: []string{"risk_check_unavailable"}, Flags: []string{}}
	}
	reported := false
	blockLow := false
	for _, reason := range res.Reasons {
		if strings.Contains(reason, "report") {
			reported = true
		}
		if reason == "name_does_not_match_bank_record" ||
			reason == "amount_far_above_your_usual_payments" ||
			reason == "same_payment_sent_minutes_ago" {
			blockLow = true
		}
	}
	if req.Recipient.ApapoPhone != "" && res.Tier != safesend.TierHigh && !reported && !blockLow {
		res.Tier = safesend.TierLow
		res.Reasons = append(res.Reasons, "apapo_verified_name")
		res.Flags = []string{}
	}
	return res
}

func (s *Server) riskCheck(w http.ResponseWriter, r *http.Request) {
	req, ok := parseRequest(w, r)
	if !ok {
		return
	}
	writeJSON(w, 200, s.riskFor(r.Context(), s.currentUserID(r), req))
}

func (s *Server) postReport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Recipient struct {
			BankCode      string `json:"bank_code"`
			AccountNumber string `json:"account_number"`
		} `json:"recipient"`
		EvidenceRef string `json:"evidence_ref"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Recipient.BankCode == "" || !tenDigits.MatchString(req.Recipient.AccountNumber) {
		writeError(w, 400, "invalid_recipient", "Recipient needs a bank and a 10 digit account number.", nil)
		return
	}
	created, err := s.deps.SafeSend.Report(r.Context(), s.currentUserID(r),
		safesend.Recipient{BankCode: req.Recipient.BankCode, AccountNumber: req.Recipient.AccountNumber}, req.EvidenceRef)
	switch {
	case errors.Is(err, safesend.ErrEvidenceRequired):
		writeError(w, 400, "evidence_required", "Add a transaction reference or screenshot id as evidence.", nil)
	case errors.Is(err, safesend.ErrReportLimit):
		writeError(w, 429, "report_limit", "You can file up to 5 reports a day.", nil)
	case err != nil:
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
	case !created:
		writeJSON(w, 200, map[string]any{"status": "already_reported"})
	default:
		writeJSON(w, 201, map[string]any{"status": "recorded"})
	}
}

func (s *Server) shieldCheck(w http.ResponseWriter, r *http.Request) {
	var amount int64
	if v := r.URL.Query().Get("amount_kobo"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n <= 0 {
			writeError(w, 400, "invalid_amount", "amount_kobo must be a positive number.", nil)
			return
		}
		amount = n
	}
	uid := s.currentUserID(r)
	accts, _, _, err := s.userAccounts(r.Context(), uid)
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	var credits []bank.Transaction
	since := time.Now().Add(-25 * time.Hour)
	for _, a := range accts {
		txs, err := s.deps.Provider.GetTransactions(r.Context(), a.ID, since, time.Now().Add(time.Hour))
		if err == nil {
			credits = append(credits, txs...)
		}
	}
	alert, err := s.deps.SafeSend.Shield(r.Context(), uid, credits, amount)
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	writeJSON(w, 200, map[string]any{"alert": alert})
}

func (s *Server) shieldDismiss(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CreditID string `json:"credit_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.CreditID == "" {
		writeError(w, 400, "invalid_request", "credit_id is required.", nil)
		return
	}
	if err := s.deps.SafeSend.Dismiss(r.Context(), s.currentUserID(r), req.CreditID); err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "dismissed"})
}
