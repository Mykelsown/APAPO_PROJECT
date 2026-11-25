package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func send(h http.Handler, method, path, token, body string) (int, map[string]any) {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func errCode(m map[string]any) string {
	e, _ := m["error"].(map[string]any)
	c, _ := e["code"].(string)
	return c
}

func TestMoneyRoutesNeedASession(t *testing.T) {
	h, _ := handler()
	for _, path := range []string{"/api/splitpay/preview", "/api/splitpay/execute"} {
		if code, _ := send(h, "POST", path, "", `{}`); code != 401 {
			t.Errorf("%s without a token: %d", path, code)
		}
		if code, _ := send(h, "POST", path, "garbage", `{}`); code != 401 {
			t.Errorf("%s with a bad token: %d", path, code)
		}
	}
}

func TestOnboardingGatesMoneyRoutes(t *testing.T) {
	h, _ := handler()
	send(h, "POST", "/api/auth/otp", "", `{"phone":"08099990000"}`)
	_, v := send(h, "POST", "/api/auth/verify-otp", "", `{"phone":"08099990000","code":"123456"}`)
	tok := v["access_token"].(string)
	body := `{"amount_kobo":100,` + recipient + `}`

	code, out := send(h, "POST", "/api/splitpay/preview", tok, body)
	if code != 403 || errCode(out) != "onboarding_required" || out["error"].(map[string]any)["details"].(map[string]any)["next_step"] != "bvn" {
		t.Fatalf("before BVN: %d %v", code, out)
	}
	if code, out := send(h, "POST", "/api/auth/pin", tok, `{"pin":"4821"}`); code != 409 || errCode(out) != "bvn_required" {
		t.Fatalf("PIN before BVN: %d %v", code, out)
	}
	send(h, "POST", "/api/auth/bvn", tok, `{"bvn":"12345678901"}`)
	code, out = send(h, "POST", "/api/splitpay/preview", tok, body)
	if code != 403 || out["error"].(map[string]any)["details"].(map[string]any)["next_step"] != "pin" {
		t.Fatalf("before PIN: %d %v", code, out)
	}
	if code, out := send(h, "POST", "/api/auth/pin", tok, `{"pin":"4821"}`); code != 200 || out["user"].(map[string]any)["pin_set"] != true {
		t.Fatalf("set PIN: %d %v", code, out)
	}
}

func TestOTPErrors(t *testing.T) {
	h, _ := handler()
	if code, out := send(h, "POST", "/api/auth/otp", "", `{"phone":"123"}`); code != 400 || errCode(out) != "invalid_phone" {
		t.Errorf("bad phone: %d %v", code, out)
	}
	send(h, "POST", "/api/auth/otp", "", `{"phone":"08011112222"}`)
	if code, out := send(h, "POST", "/api/auth/verify-otp", "", `{"phone":"08011112222","code":"000000"}`); code != 400 || errCode(out) != "invalid_otp" {
		t.Errorf("wrong code: %d %v", code, out)
	}
	for i := 0; i < 3; i++ {
		send(h, "POST", "/api/auth/otp", "", `{"phone":"08033334444"}`)
	}
	if code, out := send(h, "POST", "/api/auth/otp", "", `{"phone":"08033334444"}`); code != 429 || errCode(out) != "rate_limited" {
		t.Errorf("fourth code: %d %v", code, out)
	}
}

func TestLoginLockoutAndRefresh(t *testing.T) {
	h, _ := handler() // the demo phone is onboarded with PIN 4821
	for i := 0; i < 4; i++ {
		if code, out := send(h, "POST", "/api/auth/login", "", `{"phone":"08012345678","pin":"0000"}`); code != 401 || errCode(out) != "invalid_credentials" {
			t.Fatalf("wrong PIN %d: %d %v", i, code, out)
		}
	}
	code, out := send(h, "POST", "/api/auth/login", "", `{"phone":"08012345678","pin":"0000"}`)
	if code != 423 || errCode(out) != "locked" || out["error"].(map[string]any)["details"].(map[string]any)["locked_until"] == nil {
		t.Fatalf("fifth wrong PIN should lock: %d %v", code, out)
	}
	if code, _ := send(h, "POST", "/api/auth/login", "", `{"phone":"08012345678","pin":"4821"}`); code != 423 {
		t.Fatalf("right PIN while locked: %d", code)
	}

	// Refresh rotates the pair and kills the old one.
	h2, _ := handler()
	_, login := send(h2, "POST", "/api/auth/login", "", `{"phone":"08012345678","pin":"4821"}`)
	rt := login["refresh_token"].(string)
	code, next := send(h2, "POST", "/api/auth/refresh", "", `{"refresh_token":"`+rt+`"}`)
	if code != 200 || next["access_token"] == nil {
		t.Fatalf("refresh: %d %v", code, next)
	}
	if code, _ := send(h2, "POST", "/api/auth/refresh", "", `{"refresh_token":"`+rt+`"}`); code != 401 {
		t.Fatalf("old refresh token should be dead: %d", code)
	}
}

func TestLogoutEndsTheSession(t *testing.T) {
	h, _ := handler()
	if code, _ := send(h, "POST", "/api/auth/logout", testToken, ``); code != 200 {
		t.Fatalf("logout %d", code)
	}
	if code, _ := send(h, "POST", "/api/splitpay/preview", testToken, `{}`); code != 401 {
		t.Fatalf("token should be dead after logout: %d", code)
	}
}

func TestProfileAndTwoUserLoginRefreshLogout(t *testing.T) {
	h, _ := handler()

	signIn := func(phone, pin, displayName string) string {
		send(h, "POST", "/api/auth/otp", "", `{"phone":"`+phone+`"}`)
		code, out := send(h, "POST", "/api/auth/verify-otp", "", `{"phone":"`+phone+`","code":"123456"}`)
		if code != 200 {
			t.Fatalf("verify OTP for %s: %d %v", phone, code, out)
		}
		token := out["access_token"].(string)
		send(h, "POST", "/api/auth/bvn", token, `{"bvn":"22222222222"}`)
		send(h, "POST", "/api/auth/pin", token, `{"pin":"`+pin+`"}`)
		code, out = send(h, "PUT", "/api/me/profile", token, `{"display_name":"`+displayName+`"}`)
		if code != 200 {
			t.Fatalf("profile for %s: %d %v", phone, code, out)
		}
		return token
	}

	token1 := signIn("08099990001", "4821", "Ada One")
	token2 := signIn("08099990002", "5912", "Bola Two")

	code, me1 := send(h, "GET", "/api/me", token1, "")
	if code != 200 || me1["display_name"] != "Ada One" {
		t.Fatalf("GET /api/me user one: %d %v", code, me1)
	}
	code, me2 := send(h, "GET", "/api/me", token2, "")
	if code != 200 || me2["display_name"] != "Bola Two" {
		t.Fatalf("GET /api/me user two: %d %v", code, me2)
	}

	code, login1 := send(h, "POST", "/api/auth/login", "", `{"phone":"08099990001","pin":"4821"}`)
	if code != 200 {
		t.Fatalf("login user one: %d %v", code, login1)
	}
	refresh1 := login1["refresh_token"].(string)
	code, refreshed1 := send(h, "POST", "/api/auth/refresh", "", `{"refresh_token":"`+refresh1+`"}`)
	if code != 200 || refreshed1["access_token"] == nil {
		t.Fatalf("refresh user one: %d %v", code, refreshed1)
	}

	code, login2 := send(h, "POST", "/api/auth/login", "", `{"phone":"08099990002","pin":"5912"}`)
	if code != 200 {
		t.Fatalf("login user two: %d %v", code, login2)
	}
	code, _ = send(h, "POST", "/api/auth/logout", login2["access_token"].(string), "")
	if code != 200 {
		t.Fatalf("logout user two: %d", code)
	}
	if code, _ := send(h, "GET", "/api/me", login2["access_token"].(string), ""); code != 401 {
		t.Fatalf("user two token should be revoked: %d", code)
	}
}

func TestProfileValidation(t *testing.T) {
	h, _ := handler()
	send(h, "POST", "/api/auth/otp", "", `{"phone":"08099990003"}`)
	_, out := send(h, "POST", "/api/auth/verify-otp", "", `{"phone":"08099990003","code":"123456"}`)
	token := out["access_token"].(string)

	code, result := send(h, "PUT", "/api/me/profile", token, `{"display_name":"   "}`)
	if code != 400 || errCode(result) != "invalid_display_name" {
		t.Fatalf("blank display name: %d %v", code, result)
	}
	code, result = send(h, "PUT", "/api/me/profile", token, `{"display_name":"`+strings.Repeat("a", 81)+`"}`)
	if code != 400 || errCode(result) != "invalid_display_name" {
		t.Fatalf("long display name: %d %v", code, result)
	}
	if code, _ := send(h, "GET", "/api/me", "", ""); code != 401 {
		t.Fatalf("GET /api/me without token: %d", code)
	}
}

func TestReceivingAccountAndLookupPrivacy(t *testing.T) {
	h, _ := handler()

	tokenOne := onboard(h, "08099990011", "22222222222", "4821")
	code, profile := send(h, "PUT", "/api/me/profile", tokenOne, `{"display_name":"Ada Okafor"}`)
	if code != 200 {
		t.Fatalf("set profile: %d %v", code, profile)
	}
	for _, bankCode := range []string{"apex", "delta"} {
		code, _ = send(h, "POST", "/api/banks/link", tokenOne, `{"bank_code":"`+bankCode+`","consent":{"accepted":true,"scopes":["accounts","balances","transactions"]}}`)
		if code != 201 {
			t.Fatalf("link %s: %d", bankCode, code)
		}
	}

	code, accounts := send(h, "GET", "/api/accounts", tokenOne, "")
	if code != 200 {
		t.Fatalf("list accounts: %d %v", code, accounts)
	}
	accountList := accounts["accounts"].([]any)
	if len(accountList) == 0 {
		t.Fatal("expected linked accounts")
	}
	accountID := accountList[0].(map[string]any)["id"].(string)

	code, result := send(h, "PUT", "/api/me/receiving-account", tokenOne, `{"account_id":"`+accountID+`"}`)
	if code != 200 {
		t.Fatalf("set receiving account: %d %v", code, result)
	}
	code, me := send(h, "GET", "/api/me", tokenOne, "")
	if code != 200 {
		t.Fatalf("get me: %d %v", code, me)
	}
	if me["receiving_account"].(map[string]any)["id"] != accountID {
		t.Fatalf("GET /api/me receiving account: %v", me)
	}

	code, lookup := send(h, "GET", "/api/users/lookup?phone=08099990011", tokenOne, "")
	if code != 200 {
		t.Fatalf("lookup known user: %d %v", code, lookup)
	}
	user := lookup["user"].(map[string]any)
	if user["display_name"] != "Ada O." || user["recipient_type"] != "apapo" {
		t.Fatalf("lookup privacy: %v", lookup)
	}
	if _, exists := lookup["phone"]; exists {
		t.Fatalf("phone must not be returned: %v", lookup)
	}

	code, unknown := send(h, "GET", "/api/users/lookup?phone=08099990099", tokenOne, "")
	if code != 404 || errCode(unknown) != "not_found" {
		t.Fatalf("unknown lookup: %d %v", code, unknown)
	}

	tokenTwo := onboard(h, "08099990012", "22222222222", "4821")
	code, result = send(h, "PUT", "/api/me/receiving-account", tokenTwo, `{"account_id":"acc_apex_1"}`)
	if code == 200 {
		t.Fatalf("another user's account must not be selected: %d %v", code, result)
	}
	code, noAccountLookup := send(h, "GET", "/api/users/lookup?phone=08099990012", tokenOne, "")
	if code != 404 {
		t.Fatalf("user without receiving account must be hidden: %d %v", code, noAccountLookup)
	}
}

func TestLookupRateLimit(t *testing.T) {
	h, _ := handler()
	token := onboard(h, "08099990013", "22222222222", "4821")

	limited := false
	for i := 0; i < LookupBurst+2; i++ {
		code, _ := send(h, "GET", "/api/users/lookup?phone=08099990013", token, "")
		if code == 429 {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("lookup should be rate limited")
	}
}
