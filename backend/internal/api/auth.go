package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/auth"
)

type ctxKey int

const (
	userKey ctxKey = iota
	sessionKey
)

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<14))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "The request body is not valid.", nil)
		return false
	}
	return true
}

func userJSON(u auth.User) map[string]any {
	return map[string]any{"id": u.ID, "phone": u.Phone, "display_name": u.DisplayName, "bvn_verified": u.BVNHash != "", "pin_set": u.PINHash != ""}
}

func tokensJSON(u auth.User, t auth.Tokens) map[string]any {
	return map[string]any{
		"user": userJSON(u), "access_token": t.AccessToken, "refresh_token": t.RefreshToken,
		"access_expires_at":  t.AccessExpiresAt.UTC().Format(time.RFC3339),
		"refresh_expires_at": t.RefreshExpiresAt.UTC().Format(time.RFC3339),
	}
}

// authError maps a service error to a response. It returns false for unknown errors.
func authError(w http.ResponseWriter, err error) {
	var locked *auth.LockedError
	switch {
	case errors.Is(err, auth.ErrInvalidPhone):
		writeError(w, 400, "invalid_phone", "Enter a Nigerian phone number.", nil)
	case errors.Is(err, auth.ErrRateLimited):
		writeError(w, 429, "rate_limited", "Too many codes requested. Wait a few minutes and try again.", nil)
	case errors.Is(err, auth.ErrInvalidOTP):
		writeError(w, 400, "invalid_otp", "That code is not right.", nil)
	case errors.Is(err, auth.ErrOTPExpired):
		writeError(w, 400, "otp_expired", "That code has expired. Request a new one.", nil)
	case errors.Is(err, auth.ErrTooManyAttempts):
		writeError(w, 429, "too_many_attempts", "Too many wrong codes. Request a new one.", nil)
	case errors.Is(err, auth.ErrInvalidBVN):
		writeError(w, 400, "invalid_bvn", "BVN must be 11 digits.", nil)
	case errors.Is(err, auth.ErrBVNRequired):
		writeError(w, 409, "bvn_required", "Verify your BVN before setting a PIN.", nil)
	case errors.Is(err, auth.ErrInvalidPIN):
		writeError(w, 400, "invalid_pin", "PIN must be 4 to 6 digits.", nil)
	case errors.Is(err, auth.ErrPINAlreadySet):
		writeError(w, 409, "pin_already_set", "A PIN is already set.", nil)
	case errors.As(err, &locked):
		writeError(w, 423, "locked", "Too many wrong PINs. Try again later.", map[string]any{"locked_until": locked.Until.UTC().Format(time.RFC3339)})
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, 401, "invalid_credentials", "Wrong phone number or PIN.", nil)
	case errors.Is(err, auth.ErrInvalidToken):
		writeError(w, 401, "invalid_token", "Your session has expired. Sign in again.", nil)
	case errors.Is(err, auth.ErrInvalidDisplayName):
		writeError(w, 400, "invalid_display_name", "Display name must be 1 to 80 characters.", nil)
	case errors.Is(err, auth.ErrInvalidReceivingAccount):
		writeError(w, 404, "not_found", "Receiving account not found.", nil)
	default:
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
	}
}

func (s *Server) requestOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phone string `json:"phone"`
	}
	if !decode(w, r, &req) {
		return
	}
	if err := s.deps.Auth.RequestOTP(r.Context(), req.Phone); err != nil {
		authError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"status": "sent", "expires_in_seconds": int(auth.OTPTTL.Seconds())})
}

func (s *Server) verifyOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phone string `json:"phone"`
		Code  string `json:"code"`
	}
	if !decode(w, r, &req) {
		return
	}
	u, t, err := s.deps.Auth.VerifyOTP(r.Context(), req.Phone, req.Code)
	if err != nil {
		authError(w, err)
		return
	}
	writeJSON(w, 200, tokensJSON(u, t))
}

func (s *Server) submitBVN(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BVN string `json:"bvn"`
	}
	if !decode(w, r, &req) {
		return
	}
	u := userFrom(r.Context())
	if err := s.deps.Auth.VerifyBVN(r.Context(), u.ID, req.BVN); err != nil {
		authError(w, err)
		return
	}
	s.writeUser(w, r, u.ID)
}

func (s *Server) submitPIN(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PIN         string `json:"pin"`
		DisplayName string `json:"display_name,omitempty"`
	}
	if !decode(w, r, &req) {
		return
	}
	u := userFrom(r.Context())
	if err := s.deps.Auth.SetPIN(r.Context(), u.ID, req.PIN); err != nil {
		authError(w, err)
		return
	}
	if req.DisplayName != "" {
		if err := s.deps.Auth.SetDisplayName(r.Context(), u.ID, req.DisplayName); err != nil {
			authError(w, err)
			return
		}
	}
	s.writeUser(w, r, u.ID)
}

func (s *Server) writeUser(w http.ResponseWriter, r *http.Request, id string) {
	u, err := s.deps.Auth.Store.GetUser(r.Context(), id)
	if err != nil {
		authError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"user": userJSON(u)})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phone string `json:"phone"`
		PIN   string `json:"pin"`
	}
	if !decode(w, r, &req) {
		return
	}
	u, t, err := s.deps.Auth.Login(r.Context(), req.Phone, req.PIN)
	if err != nil {
		authError(w, err)
		return
	}
	writeJSON(w, 200, tokensJSON(u, t))
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !decode(w, r, &req) {
		return
	}
	t, err := s.deps.Auth.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		authError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{
		"access_token": t.AccessToken, "refresh_token": t.RefreshToken,
		"access_expires_at":  t.AccessExpiresAt.UTC().Format(time.RFC3339),
		"refresh_expires_at": t.RefreshExpiresAt.UTC().Format(time.RFC3339),
	})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if sess, ok := r.Context().Value(sessionKey).(auth.Session); ok {
		s.deps.Auth.Logout(r.Context(), sess.ID)
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (s *Server) getMe(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	var receivingAccount any
	if u.ReceivingAccountID != "" {
		accs, linkOf, _, err := s.userAccounts(r.Context(), u.ID)
		if err == nil {
			for _, acc := range accs {
				if acc.ID == u.ReceivingAccountID {
					receivingAccount = toAccountJSON(acc, linkOf[acc.ID])
					break
				}
			}
		}
	}
	writeJSON(w, 200, map[string]any{
		"user": userJSON(u),
		"onboarding": map[string]any{
			"bvn_verified": u.BVNHash != "",
			"pin_set":      u.PINHash != "",
			"complete":     u.Onboarded(),
		},
		"display_name":      u.DisplayName,
		"receiving_account": receivingAccount,
	})
}

func (s *Server) putProfile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DisplayName string `json:"display_name"`
	}
	if !decode(w, r, &req) {
		return
	}
	u := userFrom(r.Context())
	if err := s.deps.Auth.SetDisplayName(r.Context(), u.ID, req.DisplayName); err != nil {
		authError(w, err)
		return
	}
	s.writeUser(w, r, u.ID)
}

func (s *Server) putReceivingAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AccountID string `json:"account_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	u := userFrom(r.Context())
	accs, linkOf, _, err := s.userAccounts(r.Context(), u.ID)
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	for _, acc := range accs {
		if acc.ID == req.AccountID {
			if err := s.deps.Auth.SetReceivingAccount(r.Context(), u.ID, req.AccountID); err != nil {
				authError(w, err)
				return
			}
			writeJSON(w, 200, map[string]any{"receiving_account": toAccountJSON(acc, linkOf[acc.ID])})
			return
		}
	}
	writeError(w, 404, "not_found", "Receiving account not found.", nil)
}

func maskDisplayName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	parts := strings.Fields(name)
	first := parts[0]
	if len(parts) == 1 {
		return first
	}
	last := []rune(parts[len(parts)-1])
	if len(last) == 0 {
		return first
	}
	return first + " " + strings.ToUpper(string(last[0])) + "."
}

func (s *Server) lookupUser(w http.ResponseWriter, r *http.Request) {
	phone := r.URL.Query().Get("phone")
	normalized, err := auth.NormalizePhone(phone)
	if err != nil {
		writeError(w, 400, "invalid_phone", "Enter a Nigerian phone number.", nil)
		return
	}
	u, err := s.deps.Auth.Store.GetUserByPhone(r.Context(), normalized)
	if err != nil || !u.Onboarded() || u.ReceivingAccountID == "" {
		writeError(w, 404, "not_found", "Apapo user not found.", nil)
		return
	}
	masked := maskDisplayName(u.DisplayName)
	if masked == "" {
		writeError(w, 404, "not_found", "Apapo user not found.", nil)
		return
	}
	writeJSON(w, 200, map[string]any{
		"user": map[string]any{
			"display_name":   masked,
			"recipient_type": "apapo",
		},
	})
}

// requireAuth accepts any signed in user, including one still onboarding.
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		tok, ok := strings.CutPrefix(h, "Bearer ")
		if !ok || tok == "" {
			writeError(w, 401, "unauthorized", "Sign in to continue.", nil)
			return
		}
		u, sess, err := s.deps.Auth.Authenticate(r.Context(), tok)
		if err != nil {
			writeError(w, 401, "invalid_token", "Your session has expired. Sign in again.", nil)
			return
		}
		ctx := context.WithValue(r.Context(), userKey, u)
		ctx = context.WithValue(ctx, sessionKey, sess)
		next(w, r.WithContext(ctx))
	}
}

// requireOnboarded also needs a verified BVN and a PIN before money features open.
func (s *Server) requireOnboarded(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		u := userFrom(r.Context())
		if !u.Onboarded() {
			step := "bvn"
			if u.BVNHash != "" {
				step = "pin"
			}
			writeError(w, 403, "onboarding_required", "Finish setting up your account first.", map[string]any{"next_step": step})
			return
		}
		next(w, r)
	})
}

func userFrom(ctx context.Context) auth.User {
	u, _ := ctx.Value(userKey).(auth.User)
	return u
}
