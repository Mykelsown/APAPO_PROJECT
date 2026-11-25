package api

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/splitreceive"
)

type destInput struct {
	AccountID   string `json:"account_id"`
	Beneficiary *struct {
		BankCode      string `json:"bank_code"`
		AccountNumber string `json:"account_number"`
		AccountName   string `json:"account_name"`
	} `json:"beneficiary"`
	Percent   float64 `json:"percent"`
	FixedKobo int64   `json:"fixed_kobo"`
}

func (d destInput) toDestination() (splitreceive.Destination, bool) {
	out := splitreceive.Destination{AccountID: d.AccountID, FixedKobo: d.FixedKobo}
	if d.Beneficiary != nil {
		out.BankCode, out.AccountNumber, out.AccountName = d.Beneficiary.BankCode, d.Beneficiary.AccountNumber, d.Beneficiary.AccountName
	}
	// Percent arrives as a number with at most two decimals; it is stored as basis points.
	bps := math.Round(d.Percent * 100)
	if math.Abs(d.Percent*100-bps) > 1e-6 || d.Percent < 0 || d.Percent > 100 {
		return out, false
	}
	out.PercentBps = int(bps)
	return out, true
}

func destJSON(d splitreceive.Destination) map[string]any {
	m := map[string]any{}
	if d.AccountID != "" {
		m["account_id"] = d.AccountID
	} else {
		m["beneficiary"] = map[string]string{"bank_code": d.BankCode, "account_number": maskAccount(d.AccountNumber), "account_name": d.AccountName}
	}
	if d.PercentBps > 0 {
		m["percent"] = float64(d.PercentBps) / 100
	}
	if d.FixedKobo > 0 {
		m["fixed_kobo"] = d.FixedKobo
	}
	return m
}

func rulesJSON(r splitreceive.Rules) map[string]any {
	ds := make([]map[string]any, 0, len(r.Destinations))
	for _, d := range r.Destinations {
		ds = append(ds, destJSON(d))
	}
	return map[string]any{
		"receiving_account_id": r.ReceivingAccountID, "destinations": ds,
		"standing_consent_at": r.ConsentAt.UTC().Format(time.RFC3339), "active": r.Active(),
		"note": "Whatever is not sent stays in the receiving account.",
	}
}

func runJSON(r *splitreceive.Run) map[string]any {
	legs := make([]map[string]any, 0, len(r.Legs))
	for _, l := range r.Legs {
		legs = append(legs, map[string]any{
			"id": l.ID, "position": l.Position, "destination": destJSON(l.Dest),
			"amount_kobo": l.AmountKobo, "fee_kobo": l.FeeKobo, "state": l.State, "error": l.Error,
		})
	}
	return map[string]any{
		"id": r.ID, "credit_id": r.CreditID, "account_id": r.AccountID, "amount_kobo": r.AmountKobo,
		"received_at": r.ReceivedAt.UTC().Format(time.RFC3339), "state": r.State, "message": r.Message, "legs": legs,
		"created_at": r.CreatedAt.UTC().Format(time.RFC3339), "updated_at": r.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func srError(w http.ResponseWriter, err error) {
	var bad *splitreceive.BadRulesError
	switch {
	case errors.As(err, &bad):
		writeError(w, 400, "invalid_rules", "These rules cannot be saved: "+bad.Reason+".", nil)
	case errors.Is(err, splitreceive.ErrNoRules):
		writeError(w, 409, "no_active_rules", "Turn on Split-Receive rules first.", nil)
	case errors.Is(err, splitreceive.ErrRunNotFound):
		writeError(w, 404, "not_found", "Run not found.", nil)
	case errors.Is(err, splitreceive.ErrNothingToRetry):
		writeError(w, 409, "nothing_to_retry", "Every share in this run has already been sent.", nil)
	default:
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
	}
}

func (s *Server) getRules(w http.ResponseWriter, r *http.Request) {
	rules, ok, err := s.deps.SplitReceive.Rules(r.Context(), s.currentUserID(r))
	if err != nil {
		srError(w, err)
		return
	}
	if !ok {
		writeJSON(w, 200, map[string]any{"rules": nil})
		return
	}
	writeJSON(w, 200, map[string]any{"rules": rulesJSON(rules)})
}

func (s *Server) putRules(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ReceivingAccountID string      `json:"receiving_account_id"`
		Destinations       []destInput `json:"destinations"`
		StandingConsent    bool        `json:"standing_consent"`
		PIN                string      `json:"pin"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !req.StandingConsent {
		writeError(w, 400, "consent_required", "You must agree to automatic splitting. You can turn it off any time.", nil)
		return
	}
	uid := s.currentUserID(r)
	if err := s.deps.Auth.CheckPIN(r.Context(), uid, req.PIN); err != nil {
		pinError(w, err)
		return
	}
	dests := make([]splitreceive.Destination, 0, len(req.Destinations))
	for _, d := range req.Destinations {
		dd, ok := d.toDestination()
		if !ok {
			writeError(w, 400, "invalid_rules", "Percentages must be between 0 and 100 with at most two decimals.", nil)
			return
		}
		dests = append(dests, dd)
	}
	rules, err := s.deps.SplitReceive.SetRules(r.Context(), uid, req.ReceivingAccountID, dests)
	if err != nil {
		srError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"rules": rulesJSON(rules)})
}

func (s *Server) deleteRules(w http.ResponseWriter, r *http.Request) {
	if err := s.deps.SplitReceive.DisableRules(r.Context(), s.currentUserID(r)); err != nil {
		srError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "disabled"})
}

func (s *Server) scanCredits(w http.ResponseWriter, r *http.Request) {
	res, err := s.deps.SplitReceive.Scan(r.Context(), s.currentUserID(r))
	if err != nil {
		if errors.Is(err, splitreceive.ErrNoRules) {
			srError(w, err)
			return
		}
		writeError(w, 502, "bank_unavailable", "We could not check your receiving account. Try again shortly.", nil)
		return
	}
	ids := res.NewRuns
	if ids == nil {
		ids = []string{}
	}
	writeJSON(w, 200, map[string]any{"new_runs": ids, "ignored_unverified": res.IgnoredUnverified})
}

func (s *Server) listRuns(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 200 {
			writeError(w, 400, "invalid_query", "limit must be between 1 and 200.", nil)
			return
		}
		limit = n
	}
	runs, err := s.deps.SplitReceive.Runs(r.Context(), s.currentUserID(r), limit)
	if err != nil {
		srError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(runs))
	for _, run := range runs {
		out = append(out, runJSON(run))
	}
	writeJSON(w, 200, map[string]any{"runs": out})
}

func (s *Server) getRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.deps.SplitReceive.Run(r.Context(), s.currentUserID(r), r.PathValue("id"))
	if err != nil {
		srError(w, err)
		return
	}
	writeJSON(w, 200, runJSON(run))
}

func (s *Server) retryRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.deps.SplitReceive.Retry(r.Context(), s.currentUserID(r), r.PathValue("id"))
	if err != nil {
		srError(w, err)
		return
	}
	writeJSON(w, 200, runJSON(run))
}

func parseDay(v string) (time.Time, bool) {
	if v == "" {
		return time.Time{}, true
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t, true
	}
	t, err := time.Parse("2006-01-02", v)
	return t, err == nil
}

func (s *Server) reconciliation(w http.ResponseWriter, r *http.Request) {
	from, ok1 := parseDay(r.URL.Query().Get("from"))
	to, ok2 := parseDay(r.URL.Query().Get("to"))
	if !ok1 || !ok2 {
		writeError(w, 400, "invalid_query", "from and to must be dates like 2026-11-01.", nil)
		return
	}
	credits, totals, err := s.deps.SplitReceive.Reconciliation(r.Context(), s.currentUserID(r), from, to)
	if err != nil {
		srError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(credits))
	for _, c := range credits {
		entries := make([]map[string]any, 0, len(c.Entries))
		for _, e := range c.Entries {
			m := map[string]any{"kind": e.Kind, "amount_kobo": e.AmountKobo, "fee_kobo": e.FeeKobo}
			if e.Kind != "kept" {
				m["destination"], m["state"], m["error"] = destJSON(e.Destination), e.State, e.Error
			}
			entries = append(entries, m)
		}
		out = append(out, map[string]any{
			"run_id": c.Run.ID, "credit_id": c.Run.CreditID, "received_at": c.Run.ReceivedAt.UTC().Format(time.RFC3339),
			"amount_kobo": c.Run.AmountKobo, "run_state": c.Run.State, "entries": entries,
			"sent_kobo": c.SentKobo, "held_kobo": c.HeldKobo, "kept_kobo": c.KeptKobo, "balanced": c.Balanced,
		})
	}
	writeJSON(w, 200, map[string]any{"credits": out, "totals": map[string]any{
		"credits": totals.Credits, "credit_kobo": totals.CreditKobo, "sent_kobo": totals.SentKobo,
		"held_kobo": totals.HeldKobo, "kept_kobo": totals.KeptKobo, "fees_kobo": totals.FeesKobo,
	}})
}

// simulateCredit is a mock mode demo tool: it makes money arrive in the receiving
// account from a sender, then checks for it straight away.
func (s *Server) simulateCredit(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AmountKobo int64  `json:"amount_kobo"`
		SenderName string `json:"sender_name"`
		Verified   *bool  `json:"verified"`
		AccountID  string `json:"account_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.AmountKobo <= 0 {
		writeError(w, 400, "invalid_amount", "Amount must be greater than zero.", nil)
		return
	}
	uid := s.currentUserID(r)
	acct := req.AccountID
	if acct == "" {
		rules, ok, _ := s.deps.SplitReceive.Rules(r.Context(), uid)
		if !ok {
			writeError(w, 409, "no_active_rules", "Set Split-Receive rules first, or send account_id.", nil)
			return
		}
		acct = rules.ReceivingAccountID
	}
	sender := req.SenderName
	if sender == "" {
		sender = "Ada Stores"
	}
	verified := req.Verified == nil || *req.Verified
	tx, err := s.deps.Mock.SimulateCredit(acct, req.AmountKobo, sender, verified)
	if err != nil {
		writeError(w, 422, "cannot_simulate", "That account cannot receive a simulated credit.", nil)
		return
	}
	out := map[string]any{"credit": map[string]any{"id": tx.ID, "account_id": acct, "amount_kobo": tx.AmountKobo, "sender": sender, "verified": verified}}
	if res, err := s.deps.SplitReceive.Scan(r.Context(), uid); err == nil {
		ids := res.NewRuns
		if ids == nil {
			ids = []string{}
		}
		out["scan"] = map[string]any{"new_runs": ids, "ignored_unverified": res.IgnoredUnverified}
	}
	writeJSON(w, 201, out)
}
