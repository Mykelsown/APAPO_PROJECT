package api

import (
	"context"
	"testing"

	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
)

func TestPreviewShowsRiskTiers(t *testing.T) {
	h, _ := handler()
	body := func(acct, name string) string {
		return `{"amount_kobo":1000000,"recipient":{"bank_code":"apex","account_number":"` + acct + `","account_name":"` + name + `"}}`
	}
	code, out := send(h, "POST", "/api/splitpay/preview", testToken, body("9000000001", "Quick Returns Investments"))
	if code != 200 || out["risk"].(map[string]any)["tier"] != "high" {
		t.Fatalf("flagged: %d %v", code, out)
	}
	_, out = send(h, "POST", "/api/splitpay/preview", testToken, body("2000000004", ""))
	if out["risk"].(map[string]any)["tier"] != "unknown" {
		t.Fatalf("unknown: %v", out)
	}
	_, out = send(h, "POST", "/api/splitpay/preview", testToken, body("1000000001", "Someone Else"))
	if fl := out["flags"].([]any); len(fl) == 0 {
		t.Fatalf("mismatch not flagged: %v", out)
	}
}

func TestReportEndpoint(t *testing.T) {
	h, _ := handler()
	if code, out := send(h, "POST", "/api/reports", testToken, `{"recipient":{"bank_code":"apex","account_number":"5555555555"},"evidence_ref":""}`); code != 400 || errCode(out) != "evidence_required" {
		t.Fatalf("%d %v", code, out)
	}
	if code, _ := send(h, "POST", "/api/reports", testToken, `{"recipient":{"bank_code":"apex","account_number":"5555555555"},"evidence_ref":"txn-98765"}`); code != 201 {
		t.Fatal(code)
	}
	if code, out := send(h, "POST", "/api/reports", testToken, `{"recipient":{"bank_code":"apex","account_number":"5555555555"},"evidence_ref":"txn-98765"}`); code != 200 || out["status"] != "already_reported" {
		t.Fatalf("%d %v", code, out)
	}
}

func TestP2PSafeSendCleanAndReported(t *testing.T) {
	h, p := handler()
	_, accountID := setupP2PUser(t, h, "08099990041", "5912", "Rita Reports")
	code, accounts := send(h, "GET", "/api/accounts", testToken, "")
	if code != 200 {
		t.Fatalf("sender accounts: %d %v", code, accounts)
	}
	_ = accountID

	clean := `{"amount_kobo":100000,"recipient":{"apapo_phone":"08099990041"}}`
	code, preview := send(h, "POST", "/api/splitpay/preview", testToken, clean)
	if code != 200 || preview["risk"].(map[string]any)["tier"] != "low" {
		t.Fatalf("clean P2P Safe Send: %d %v", code, preview)
	}

	recipientToken, recipientAccountID := setupP2PUser(t, h, "08099990042", "5912", "Reported Account")
	_ = recipientToken
	code, login := send(h, "POST", "/api/auth/login", "", `{"phone":"08099990042","pin":"5912"}`)
	if code != 200 {
		t.Fatalf("recipient login: %d %v", code, login)
	}
	recipientUserID := login["user"].(map[string]any)["id"].(string)
	recipientAccounts, err := p.GetAccounts(context.Background(), recipientUserID)
	if err != nil || len(recipientAccounts) == 0 {
		t.Fatalf("recipient provider accounts: %v %+v", err, recipientAccounts)
	}
	accountNumber := ""
	for _, account := range recipientAccounts {
		if account.ID == recipientAccountID {
			accountNumber = account.AccountNumber
			break
		}
	}
	if accountNumber == "" {
		t.Fatal("recipient receiving account missing")
	}

	for i := 0; i < 3; i++ {
		reporter := "reporter-" + string(rune('a'+i))
		code, out := send(h, "POST", "/api/reports", testToken, `{"recipient":{"bank_code":"apex","account_number":"`+accountNumber+`"},"evidence_ref":"evidence-`+reporter+`"}`)
		if code != 201 && code != 200 {
			t.Fatalf("seed report %d: %d %v", i, code, out)
		}
	}
	reported := `{"amount_kobo":100000,"recipient":{"apapo_phone":"08099990042"}}`
	code, preview = send(h, "POST", "/api/splitpay/preview", testToken, reported)
	if code != 200 {
		t.Fatalf("reported P2P preview: %d %v", code, preview)
	}
	if preview["risk"].(map[string]any)["tier"] == "low" {
		t.Fatalf("reported P2P recipient reached low: %v", preview)
	}
	_ = recipientAccountID
}

func TestShieldEndpointAndDashboardUnverified(t *testing.T) {
	h, p := handler()
	mock.SeedUnverifiedCredit(p)
	_, out := send(h, "GET", "/api/shield/check?amount_kobo=7800000", testToken, "")
	alert, _ := out["alert"].(map[string]any)
	if alert == nil {
		t.Fatalf("no alert: %v", out)
	}
	// the dashboard marks the credit unverified
	_, dash := getDash(t, h, "?limit=100")
	items, _ := feedOf(dash)
	found := false
	for _, x := range items {
		if x.(map[string]any)["id"] == alert["credit_id"] && x.(map[string]any)["verification"] == "unverified" {
			found = true
		}
	}
	if !found {
		t.Fatal("credit not shown as unverified")
	}
	send(h, "POST", "/api/shield/dismiss", testToken, `{"credit_id":"`+alert["credit_id"].(string)+`"}`)
	_, out = send(h, "GET", "/api/shield/check?amount_kobo=7800000", testToken, "")
	if out["alert"] != nil {
		t.Fatal("alert after dismiss")
	}
	if code, _ := send(h, "GET", "/api/shield/check?amount_kobo=-1", testToken, ""); code != 400 {
		t.Fatal("bad amount accepted")
	}
}

// The frontend keeps display fields on a chosen recipient and sends them back.
// They must not make the whole request invalid, and the flagged payee must still
// reach the high risk tier.
func TestPreviewAcceptsFrontendDisplayFields(t *testing.T) {
	h, _ := handler()
	body := `{"amount_kobo":1000000,"recipient":{"bank_code":"apex","account_number":"9000000001","account_name":"Quick Returns Investments","recipient_type":"outside","masked_display_name":"ignored"}}`
	code, out := send(h, "POST", "/api/splitpay/preview", testToken, body)
	if code != 200 || out["risk"].(map[string]any)["tier"] != "high" {
		t.Fatalf("display fields rejected or risk lost: %d %v", code, out)
	}
	// A truly unknown field is still refused.
	code, out = send(h, "POST", "/api/splitpay/preview", testToken, `{"amount_kobo":1000000,"bogus":1,"recipient":{"bank_code":"apex","account_number":"9000000001"}}`)
	if code != 400 || errCode(out) != "invalid_json" {
		t.Fatalf("unknown field accepted: %d %v", code, out)
	}
}
