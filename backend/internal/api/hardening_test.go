package api

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/audit"
)

func doReq(h http.Handler, method, path string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestCORSAllowsOnlyTheConfiguredOrigin(t *testing.T) {
	const app = "https://app.apapo.test"
	h, _ := handlerWith(func(d *Deps) { d.AllowedOrigin = app })
	pre := map[string]string{"Origin": app, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type, idempotency-key"}

	rec := doReq(h, "OPTIONS", "/api/splitpay/execute", pre)
	if rec.Code != 204 || rec.Header().Get("Access-Control-Allow-Origin") != app {
		t.Fatalf("preflight: %d %v", rec.Code, rec.Header())
	}
	for _, want := range []string{"Authorization", "Content-Type", "Idempotency-Key"} {
		if !strings.Contains(rec.Header().Get("Access-Control-Allow-Headers"), want) {
			t.Fatalf("allow headers miss %s: %v", want, rec.Header())
		}
	}
	if rec := doReq(h, "GET", "/healthz", map[string]string{"Origin": app}); rec.Header().Get("Access-Control-Allow-Origin") != app || !strings.Contains(strings.Join(rec.Header().Values("Vary"), ","), "Origin") {
		t.Fatalf("simple request: %v", rec.Header())
	}

	pre["Origin"] = "https://evil.test"
	if rec := doReq(h, "OPTIONS", "/api/splitpay/execute", pre); rec.Code != 403 || rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("other origin preflight: %d %v", rec.Code, rec.Header())
	}
	if rec := doReq(h, "GET", "/healthz", map[string]string{"Origin": "https://evil.test"}); rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("other origin got CORS headers")
	}

	// No origin configured: nobody gets cross-origin access.
	h2, _ := handler()
	if rec := doReq(h2, "OPTIONS", "/api/auth/otp", map[string]string{"Origin": app, "Access-Control-Request-Method": "POST"}); rec.Code != 403 || rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("default should deny: %d %v", rec.Code, rec.Header())
	}
}

func TestAuthRateLimitPerIP(t *testing.T) {
	h, _ := handlerWith(func(d *Deps) { d.AuthBurst, d.AuthPerMinute = 3, 1 })
	// handler() already spent tokens onboarding from the default test IP, so use fresh ones.
	hit := func(ip, xff string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"phone":"08099999999","pin":"0000"}`))
		req.RemoteAddr = ip + ":5555"
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	for i := 0; i < 3; i++ {
		if rec := hit("10.0.0.1", ""); rec.Code == 429 {
			t.Fatalf("request %d limited too early", i)
		}
	}
	rec := hit("10.0.0.1", "")
	if rec.Code != 429 || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("fourth request: %d %v", rec.Code, rec.Header())
	}
	if rec := hit("10.0.0.2", ""); rec.Code == 429 {
		t.Fatal("another IP was limited")
	}
	// Without TrustProxy a forged header does not buy a fresh bucket.
	if rec := hit("10.0.0.1", "1.2.3.4"); rec.Code != 429 {
		t.Fatalf("X-Forwarded-For trusted by default: %d", rec.Code)
	}
	// Non-auth routes are not limited here.
	req := httptest.NewRequest("GET", "/healthz", nil)
	req.RemoteAddr = "10.0.0.1:5555"
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("healthz limited: %d", rec.Code)
	}
}

func TestClientIPBehindProxy(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "172.16.0.9:443"
	req.Header.Set("X-Forwarded-For", "6.6.6.6, 41.58.1.2")
	if got := clientIP(req, true); got != "41.58.1.2" {
		t.Fatalf("trusted proxy: %s", got)
	}
	if got := clientIP(req, false); got != "172.16.0.9" {
		t.Fatalf("untrusted: %s", got)
	}
}

func TestIPLimiterRefills(t *testing.T) {
	now := time.Unix(0, 0)
	l := newIPLimiter(2, 60)
	l.now = func() time.Time { return now }
	l.take("a")
	l.take("a")
	if ok, wait := l.take("a"); ok || wait <= 0 || wait > time.Second {
		t.Fatalf("empty bucket: %v %v", ok, wait)
	}
	now = now.Add(time.Second)
	if ok, _ := l.take("a"); !ok {
		t.Fatal("did not refill")
	}
}

func TestRequestsCarryADeadline(t *testing.T) {
	var dl time.Time
	var ok bool
	h := withTimeout(2*time.Second, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { dl, ok = r.Context().Deadline() }))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	if !ok || time.Until(dl) > 2*time.Second {
		t.Fatalf("deadline %v %v", dl, ok)
	}
}

// Walks every flow that touches a secret and checks that no response body (other
// than the ones that hand out tokens), no audit entry and no log line carries a
// token, the PIN, the BVN or the sign in code.
func TestNoSecretsInResponsesAuditOrLogs(t *testing.T) {
	var logs bytes.Buffer
	orig := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(orig)
	var aud *audit.Memory
	h, _ := handlerWith(func(d *Deps) { aud = d.Audit.(*audit.Memory) })

	const pin, bvn, otp = "4821", "22222222222", "123456"
	// Session tokens for a fresh login.
	code, login := send(h, "POST", "/api/auth/login", "", `{"phone":"08012345678","pin":"`+pin+`"}`)
	if code != 200 {
		t.Fatalf("login %d %v", code, login)
	}
	access, refresh := login["access_token"].(string), login["refresh_token"].(string)
	secrets := map[string]string{"pin": pin, "bvn": bvn, "otp": otp, "access token": access, "refresh token": refresh, "test token": testToken}

	var bodies []string
	call := func(method, path, body string) {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+access)
		req.Header.Set("Idempotency-Key", "leak-check-0001")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		bodies = append(bodies, path+" "+rec.Body.String())
	}
	call("POST", "/api/splitpay/preview", `{"amount_kobo":15000000,`+recipient+`}`)
	call("POST", "/api/splitpay/execute", `{"pin":"`+pin+`","amount_kobo":15000000,`+recipient+`}`)
	call("POST", "/api/splitpay/execute", `{"pin":"0000","amount_kobo":100,`+recipient+`}`)
	call("PUT", "/api/security/limits", `{"daily_limit_kobo":20000000,"pin":"`+pin+`"}`)
	call("PUT", "/api/splitreceive/rules", `{"pin":"`+pin+`","standing_consent":true,"receiving_account_id":"acc_apex_1","destinations":[{"account_id":"acc_delta_1","percent":10}]}`)
	call("POST", "/api/auth/bvn", `{"bvn":"`+bvn+`"}`)
	call("POST", "/api/auth/pin", `{"pin":"`+pin+`"}`)
	call("GET", "/api/audit?limit=100", "")
	call("GET", "/api/sessions", "")
	call("GET", "/api/dashboard", "")
	call("GET", "/api/security/limits", "")

	entries := aud.All()
	var auditText strings.Builder
	for _, e := range entries {
		d, _ := json.Marshal(e.Detail)
		auditText.WriteString(e.Event + " " + e.SubjectID + " " + string(d) + "\n")
	}
	if len(entries) == 0 {
		t.Fatal("no audit entries to check")
	}
	logText := ""
	for _, line := range strings.Split(logs.String(), "\n") {
		// The development sender prints the code by design; H6 replaces it with SMS.
		if !strings.Contains(line, "(dev log sender)") {
			logText += line + "\n"
		}
	}
	// Numeric secrets must stand alone: 123456 sits inside the phone number +2348012345678.
	leaks := func(text, secret string) bool {
		if strings.Trim(secret, "0123456789") != "" {
			return strings.Contains(text, secret)
		}
		return regexp.MustCompile(`(^|\D)` + secret + `(\D|$)`).MatchString(text)
	}
	for name, v := range secrets {
		for _, b := range bodies {
			if leaks(b, v) {
				t.Errorf("%s leaked in response: %s", name, b)
			}
		}
		if leaks(auditText.String(), v) {
			t.Errorf("%s leaked in audit: %s", name, auditText.String())
		}
		if leaks(logText, v) {
			t.Errorf("%s leaked in logs: %s", name, logText)
		}
	}
}
