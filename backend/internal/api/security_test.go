package api

import (
	"fmt"
	"strings"
	"sync"
	"testing"
)

func TestExecuteNeedsCorrectPIN(t *testing.T) {
	h, _ := handler()
	body := `{"amount_kobo":15000000,` + recipient + `}`
	if rec := executeRaw(h, "key-nopin001", body); rec.Code != 401 {
		t.Fatalf("no PIN: %d", rec.Code)
	}
	if rec := executeRaw(h, "key-badpin01", `{"pin":"0000",`+body[1:]); rec.Code != 401 {
		t.Fatalf("wrong PIN: %d", rec.Code)
	}
	// Five wrong PINs lock the account for money actions.
	var code int
	for i := 0; i < 5; i++ {
		code = executeRaw(h, "key-lock-00"+string(rune('a'+i)), `{"pin":"1111",`+body[1:]).Code
	}
	if code != 423 {
		t.Fatalf("expected lockout, got %d", code)
	}
	if rec := execute(h, "key-afterlock", body); rec.Code != 423 {
		t.Fatalf("correct PIN while locked: %d", rec.Code)
	}
}

func TestDailyLimitEnforcedInPreviewAndExecute(t *testing.T) {
	h, _ := handler()
	if code, out := send(h, "PUT", "/api/security/limits", testToken, `{"daily_limit_kobo":20000000,"pin":"0000"}`); code != 401 {
		t.Fatalf("limit change without PIN: %d %v", code, out)
	}
	if code, out := send(h, "PUT", "/api/security/limits", testToken, `{"daily_limit_kobo":5,"pin":"4821"}`); code != 400 {
		t.Fatalf("tiny limit accepted: %d %v", code, out)
	}
	if code, out := send(h, "PUT", "/api/security/limits", testToken, `{"daily_limit_kobo":20000000,"pin":"4821"}`); code != 200 || out["daily_limit_kobo"].(float64) != 20000000 {
		t.Fatalf("%d %v", code, out)
	}
	body := `{"amount_kobo":15000000,` + recipient + `}`
	if rec := execute(h, "key-limit-01", body); rec.Code != 202 {
		t.Fatalf("first payment: %d %s", rec.Code, rec.Body)
	}
	_, lim := send(h, "GET", "/api/security/limits", testToken, "")
	if lim["spent_today_kobo"].(float64) != 15000000 || lim["remaining_kobo"].(float64) != 5000000 {
		t.Fatalf("usage %v", lim)
	}
	code, out := send(h, "POST", "/api/splitpay/preview", testToken, body)
	if code != 422 || errCode(out) != "daily_limit_exceeded" {
		t.Fatalf("preview over limit: %d %v", code, out)
	}
	if rec := execute(h, "key-limit-02", body); rec.Code != 422 {
		t.Fatalf("execute over limit: %d", rec.Code)
	}
}

func TestAuditEndpointAndSessions(t *testing.T) {
	h, _ := handler()
	send(h, "PUT", "/api/security/limits", testToken, `{"daily_limit_kobo":20000000,"pin":"4821"}`)
	code, out := send(h, "GET", "/api/audit?limit=100", testToken, "")
	if code != 200 {
		t.Fatalf("%d", code)
	}
	found := false
	for _, e := range out["entries"].([]any) {
		if e.(map[string]any)["event"] == "security.limit_changed" {
			found = true
		}
	}
	if !found {
		t.Fatalf("limit change not audited: %v", out)
	}
	if code, _ := send(h, "GET", "/api/audit?limit=0", testToken, ""); code != 400 {
		t.Fatal("bad limit accepted")
	}
	_, sess := send(h, "GET", "/api/sessions", testToken, "")
	list := sess["sessions"].([]any)
	if len(list) == 0 || list[0].(map[string]any)["current"] != true {
		t.Fatalf("sessions %v", sess)
	}
	if code, _ := send(h, "POST", "/api/sessions/logout-all", testToken, ""); code != 200 {
		t.Fatal("logout-all")
	}
	if code, _ := send(h, "GET", "/api/dashboard", testToken, ""); code != 401 {
		t.Fatalf("token still valid after logout-all: %d", code)
	}
}

func TestSecurityHeaders(t *testing.T) {
	h, _ := handler()
	rec := post(h, `{}`)
	for _, k := range []string{"X-Content-Type-Options", "Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options"} {
		if rec.Header().Get(k) == "" {
			t.Fatalf("missing %s", k)
		}
	}
	_ = strings.TrimSpace
}

func TestConcurrentExecutesRespectDailyLimit(t *testing.T) {
	h, _ := handler()
	if code, out := send(h, "PUT", "/api/security/limits", testToken, `{"daily_limit_kobo":1000000,"pin":"4821"}`); code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	// N10,000 limit, N3,000 each: exactly 3 of 12 may start.
	body := `{"amount_kobo":300000,` + recipient + `}`
	codes := make(chan int, 12)
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes <- execute(h, fmt.Sprintf("key-race-%03d", i), body).Code
		}(i)
	}
	wg.Wait()
	close(codes)
	got := map[int]int{}
	for c := range codes {
		got[c]++
	}
	if got[202] != 3 || got[422] != 9 {
		t.Fatalf("status counts %v", got)
	}
	_, lim := send(h, "GET", "/api/security/limits", testToken, "")
	if lim["spent_today_kobo"].(float64) != 900000 {
		t.Fatalf("usage %v", lim)
	}
}
