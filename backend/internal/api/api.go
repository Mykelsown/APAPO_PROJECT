// Package api holds the HTTP layer. Handlers stay thin: they validate input,
// call a domain package and shape the response described in docs/api-contract.md.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/audit"
	"github.com/Mykelsown/apapo/backend/internal/auth"
	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
	"github.com/Mykelsown/apapo/backend/internal/categorize"
	"github.com/Mykelsown/apapo/backend/internal/limits"
	"github.com/Mykelsown/apapo/backend/internal/links"
	"github.com/Mykelsown/apapo/backend/internal/payments"
	"github.com/Mykelsown/apapo/backend/internal/safesend"
	"github.com/Mykelsown/apapo/backend/internal/splitreceive"
)

type Deps struct {
	Provider bank.Provider
	Executor *payments.Executor
	Store    payments.Store
	// Mock is set only in mock mode. It enables the demo failure switch.
	Mock *mock.Provider
	Auth *auth.Service
	// Linker and Links manage which banks each user connected.
	Linker       bank.Linker
	Links        *links.Service
	Audit        audit.Logger
	SplitReceive *splitreceive.Service
	SafeSend     *safesend.Service
	Limits       *limits.Service
	// Categories labels transactions and holds per merchant overrides.
	Categories *categorize.Service
	// Verifier marks transactions confirmed or unverified (Safe Send, B6). Nil means all confirmed.
	Verifier func(ctx context.Context, userID string, txs []bank.Transaction) []string
	// Async runs background work. Defaults to a goroutine; tests run it inline.
	Async func(func())
	// AllowedOrigin is the one browser origin allowed to call the API (the frontend).
	// Empty means no cross-origin access.
	AllowedOrigin string
	// RequestTimeout caps each request. Zero means DefaultRequestTimeout.
	RequestTimeout time.Duration
	// AuthBurst and AuthPerMinute shape the per-IP limit on /api/auth/. Zero means the defaults.
	AuthBurst, AuthPerMinute int
	// TrustProxy reads the client IP from X-Forwarded-For. Set it only behind a proxy you run.
	TrustProxy bool
}

type Server struct {
	deps Deps
}

func (s *Server) async(f func()) {
	if s.deps.Async != nil {
		s.deps.Async(f)
		return
	}
	go f()
}

func New(d Deps) http.Handler {
	s := &Server{deps: d}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/auth/otp", s.requestOTP)
	mux.HandleFunc("POST /api/auth/verify-otp", s.verifyOTP)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/refresh", s.refresh)
	mux.HandleFunc("POST /api/auth/bvn", s.requireAuth(s.submitBVN))
	mux.HandleFunc("POST /api/auth/pin", s.requireAuth(s.submitPIN))
	mux.HandleFunc("POST /api/auth/logout", s.requireAuth(s.logout))
	mux.HandleFunc("GET /api/me", s.requireAuth(s.getMe))
	mux.HandleFunc("PUT /api/me/profile", s.requireAuth(s.putProfile))
	mux.HandleFunc("PUT /api/me/receiving-account", s.requireOnboarded(s.putReceivingAccount))
	mux.HandleFunc("GET /api/users/lookup", s.requireAuth(s.lookupUser))
	if d.Limits != nil {
		mux.HandleFunc("GET /api/security/limits", s.requireOnboarded(s.getLimits))
		mux.HandleFunc("PUT /api/security/limits", s.requireOnboarded(s.putLimits))
	}
	mux.HandleFunc("GET /api/audit", s.requireOnboarded(s.listAudit))
	mux.HandleFunc("GET /api/sessions", s.requireOnboarded(s.listSessions))
	mux.HandleFunc("POST /api/sessions/logout-all", s.requireAuth(s.logoutAll))
	mux.HandleFunc("GET /api/banks/supported", s.requireOnboarded(s.supportedBanks))
	mux.HandleFunc("GET /api/banks/linked", s.requireOnboarded(s.linkedBanks))
	mux.HandleFunc("POST /api/banks/link", s.requireOnboarded(s.linkBank))
	mux.HandleFunc("DELETE /api/banks/{id}", s.requireOnboarded(s.revokeBank))
	mux.HandleFunc("GET /api/dashboard", s.requireOnboarded(s.dashboard))
	mux.HandleFunc("PUT /api/categories/override", s.requireOnboarded(s.setOverride))
	mux.HandleFunc("GET /api/insights/shifts", s.requireOnboarded(s.insightShifts))
	mux.HandleFunc("GET /api/accounts", s.requireOnboarded(s.listAccounts))
	mux.HandleFunc("POST /api/splitpay/preview", s.requireOnboarded(s.splitPayPreview))
	mux.HandleFunc("POST /api/splitpay/execute", s.requireOnboarded(s.splitPayExecute))
	mux.HandleFunc("GET /api/splitpay/{id}", s.requireOnboarded(s.splitPayStatus))
	mux.HandleFunc("GET /api/payments", s.requireOnboarded(s.listPayments))
	mux.HandleFunc("GET /api/recipients/recent", s.requireOnboarded(s.recentRecipients))
	mux.HandleFunc("GET /api/splitreceive/rules", s.requireOnboarded(s.getRules))
	mux.HandleFunc("PUT /api/splitreceive/rules", s.requireOnboarded(s.putRules))
	mux.HandleFunc("DELETE /api/splitreceive/rules", s.requireOnboarded(s.deleteRules))
	mux.HandleFunc("POST /api/splitreceive/scan", s.requireOnboarded(s.scanCredits))
	mux.HandleFunc("GET /api/splitreceive/runs", s.requireOnboarded(s.listRuns))
	mux.HandleFunc("GET /api/splitreceive/runs/{id}", s.requireOnboarded(s.getRun))
	mux.HandleFunc("POST /api/splitreceive/runs/{id}/retry", s.requireOnboarded(s.retryRun))
	mux.HandleFunc("GET /api/reconciliation", s.requireOnboarded(s.reconciliation))
	if d.SafeSend != nil {
		mux.HandleFunc("POST /api/risk/check", s.requireOnboarded(s.riskCheck))
		mux.HandleFunc("POST /api/reports", s.requireOnboarded(s.postReport))
		mux.HandleFunc("GET /api/shield/check", s.requireOnboarded(s.shieldCheck))
		mux.HandleFunc("POST /api/shield/dismiss", s.requireOnboarded(s.shieldDismiss))
	}
	if d.Mock != nil {
		mux.HandleFunc("POST /api/demo/simulate-credit", s.requireOnboarded(s.simulateCredit))
		mux.HandleFunc("POST /api/demo/failure", s.demoFailure)
	}
	timeout := d.RequestTimeout
	if timeout <= 0 {
		timeout = DefaultRequestTimeout
	}
	burst, perMin := d.AuthBurst, d.AuthPerMinute
	if burst <= 0 {
		burst = DefaultAuthBurst
	}
	if perMin <= 0 {
		perMin = DefaultAuthPerMinute
	}
	var h http.Handler = mux
	h = withAuthRateLimit(newIPLimiter(burst, perMin), d.TrustProxy, h)
	h = withLookupRateLimit(newIPLimiter(LookupBurst, LookupPerMinute), d.TrustProxy, h)
	h = withTimeout(timeout, h)
	h = withCORS(d.AllowedOrigin, h)
	return withSecurityHeaders(h)
}

// currentUserID is the signed in user, set by the auth middleware.
func (s *Server) currentUserID(r *http.Request) string { return userFrom(r.Context()).ID }

type apiError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

func writeError(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	writeJSON(w, status, map[string]any{"error": apiError{code, message, details}})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// maskAccount keeps only the last four digits.
func maskAccount(n string) string {
	if len(n) <= 4 {
		return n
	}
	return "******" + n[len(n)-4:]
}
