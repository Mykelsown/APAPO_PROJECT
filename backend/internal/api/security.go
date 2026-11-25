package api

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/audit"
	"github.com/Mykelsown/apapo/backend/internal/auth"
	"github.com/Mykelsown/apapo/backend/internal/limits"
)

// withSecurityHeaders adds the headers every response should carry. This is an API,
// so the content security policy forbids everything.
func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// checkLimit refuses a payment that would pass today's limit. It has already written
// the response when it returns false.
func (s *Server) checkLimit(w http.ResponseWriter, r *http.Request, amountKobo int64) bool {
	if s.deps.Limits == nil {
		return true
	}
	return s.limitOK(w, s.deps.Limits.Allow(r.Context(), s.currentUserID(r), amountKobo))
}

// limitOK turns a limit check result into a response. It has already written the
// response when it returns false.
func (s *Server) limitOK(w http.ResponseWriter, err error) bool {
	var ex *limits.ExceededError
	switch {
	case err == nil:
		return true
	case errors.As(err, &ex):
		writeError(w, 422, "daily_limit_exceeded", "This would pass your daily limit. You can change it in security settings.",
			map[string]any{"limit_kobo": ex.LimitKobo, "spent_kobo": ex.SpentKobo, "remaining_kobo": ex.RemainingKobo})
	default:
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
	}
	return false
}

func (s *Server) getLimits(w http.ResponseWriter, r *http.Request) {
	st, err := s.deps.Limits.Status(r.Context(), s.currentUserID(r))
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	writeJSON(w, 200, map[string]any{
		"daily_limit_kobo": st.LimitKobo, "spent_today_kobo": st.SpentKobo, "remaining_kobo": st.RemainingKobo,
		"min_kobo": limits.MinDailyKobo, "max_kobo": limits.MaxDailyKobo, "default_kobo": limits.DefaultDailyKobo,
	})
}

func (s *Server) putLimits(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DailyLimitKobo int64  `json:"daily_limit_kobo"`
		PIN            string `json:"pin"`
	}
	if !decode(w, r, &req) {
		return
	}
	uid := s.currentUserID(r)
	if err := s.deps.Auth.CheckPIN(r.Context(), uid, req.PIN); err != nil {
		pinError(w, err)
		return
	}
	if err := s.deps.Limits.Set(r.Context(), uid, req.DailyLimitKobo); err != nil {
		writeError(w, 400, "invalid_limit", "The limit must be between N1,000 and N10,000,000.",
			map[string]any{"min_kobo": limits.MinDailyKobo, "max_kobo": limits.MaxDailyKobo})
		return
	}
	s.audit(r, "security.limit_changed", uid, map[string]any{"daily_limit_kobo": req.DailyLimitKobo})
	s.getLimits(w, r)
}

func (s *Server) listAudit(w http.ResponseWriter, r *http.Request) {
	limit, before := 50, int64(0)
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 200 {
			writeError(w, 400, "invalid_query", "limit must be between 1 and 200.", nil)
			return
		}
		limit = n
	}
	if v := r.URL.Query().Get("before"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1 {
			writeError(w, 400, "invalid_query", "before must be an entry id.", nil)
			return
		}
		before = n
	}
	entries, err := s.deps.Audit.List(r.Context(), s.currentUserID(r), limit, before)
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	out := make([]map[string]any, 0, len(entries))
	var next any
	for _, e := range entries {
		out = append(out, map[string]any{"id": e.ID, "event": e.Event, "subject_id": e.SubjectID, "detail": scrub(e.Detail), "at": e.At.UTC().Format(time.RFC3339)})
	}
	if len(entries) == limit {
		next = entries[len(entries)-1].ID
	}
	writeJSON(w, 200, map[string]any{"entries": out, "next_before": next})
}

// scrub drops anything that looks like a secret before audit detail leaves the server.
func scrub(d map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range d {
		switch k {
		case "token", "pin", "otp", "bvn", "provider_token", "password":
			continue
		}
		out[k] = v
	}
	return out
}

func (s *Server) audit(r *http.Request, event, subject string, detail map[string]any) {
	if s.deps.Audit == nil {
		return
	}
	s.deps.Audit.Log(r.Context(), auditEntry(s.currentUserID(r), event, subject, detail))
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	list, err := s.deps.Auth.Sessions(r.Context(), s.currentUserID(r))
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	cur := currentSessionID(r)
	out := make([]map[string]any, 0, len(list))
	for _, x := range list {
		out = append(out, map[string]any{"id": x.ID, "current": x.ID == cur, "expires_at": x.RefreshExpires.UTC().Format(time.RFC3339)})
	}
	writeJSON(w, 200, map[string]any{"sessions": out})
}

func (s *Server) logoutAll(w http.ResponseWriter, r *http.Request) {
	uid := s.currentUserID(r)
	if err := s.deps.Auth.LogoutAll(r.Context(), uid); err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	s.audit(r, "security.logout_all", uid, nil)
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func currentSessionID(r *http.Request) string {
	if sess, ok := r.Context().Value(sessionKey).(auth.Session); ok {
		return sess.ID
	}
	return ""
}

func auditEntry(user, event, subject string, detail map[string]any) audit.Entry {
	return audit.Entry{UserID: user, Event: event, SubjectID: subject, Detail: detail, At: time.Now().UTC()}
}

// pinError answers a failed PIN check: wrong PIN, or locked out after too many tries.
func pinError(w http.ResponseWriter, err error) {
	if errors.Is(err, auth.ErrInvalidCredentials) {
		writeError(w, http.StatusUnauthorized, "invalid_pin", "Wrong PIN.", nil)
		return
	}
	authError(w, err)
}
