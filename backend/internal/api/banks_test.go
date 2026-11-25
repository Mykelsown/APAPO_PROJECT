package api

import (
	"testing"

	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
)

const consent = `"consent":{"accepted":true,"scopes":["accounts","balances"]}`

func TestSupportedBanksAndConsentText(t *testing.T) {
	h, _ := handler()
	code, out := send(h, "GET", "/api/banks/supported", testToken, "")
	if code != 200 {
		t.Fatal(code)
	}
	banks := out["banks"].([]any)
	if len(banks) != 7 {
		t.Fatalf("banks %d", len(banks))
	}
	c := out["consent"].(map[string]any)
	if c["duration_days"].(float64) != 90 || len(c["scopes"].([]any)) != 3 {
		t.Fatalf("consent %v", c)
	}
}

func TestLinkListAndRevokeFlow(t *testing.T) {
	h, _ := handler()
	tok := onboard(h, "08055556666", "11111111111", "1357")
	for _, bank := range []string{"apex", "delta"} {
		if code, out := send(h, "POST", "/api/banks/link", tok, `{"bank_code":"`+bank+`",`+consent+`}`); code != 201 {
			t.Fatalf("link %s: %d %v", bank, code, out)
		}
	}
	_, out := send(h, "GET", "/api/accounts", tok, "")
	accs := out["accounts"].([]any)
	if len(accs) != 2 || accs[0].(map[string]any)["account_number"].(string)[:6] != "******" {
		t.Fatalf("accounts %v", out)
	}
	// Revoke one: its accounts disappear and Split-Pay can no longer use them.
	_, linked := send(h, "GET", "/api/banks/linked", tok, "")
	id := linked["links"].([]any)[0].(map[string]any)["id"].(string)
	if code, _ := send(h, "DELETE", "/api/banks/"+id, tok, ""); code != 200 {
		t.Fatalf("revoke %d", code)
	}
	_, out = send(h, "GET", "/api/accounts", tok, "")
	if len(out["accounts"].([]any)) != 1 {
		t.Fatalf("revoked bank still listed: %v", out)
	}
	body := `{"amount_kobo":9000000,` + recipient + `}`
	code, res := send(h, "POST", "/api/splitpay/preview", tok, body)
	if code != 422 || errCode(res) != "insufficient_funds" {
		t.Fatalf("revoked funds must not be used: %d %v", code, res)
	}
}

func TestLinkErrors(t *testing.T) {
	h, p := handler()
	tok := onboard(h, "08077778888", "11111111111", "1357")
	cases := []struct {
		name, body string
		code       int
		err        string
	}{
		{"no consent", `{"bank_code":"apex","consent":{"accepted":false,"scopes":["accounts"]}}`, 400, "consent_required"},
		{"bad scopes", `{"bank_code":"apex","consent":{"accepted":true,"scopes":["balances"]}}`, 400, "invalid_consent"},
		{"coming soon", `{"bank_code":"lagoon",` + consent + `}`, 422, "bank_not_supported"},
	}
	for _, c := range cases {
		code, out := send(h, "POST", "/api/banks/link", tok, c.body)
		if code != c.code || errCode(out) != c.err {
			t.Errorf("%s: %d %v", c.name, code, out)
		}
	}
	send(h, "POST", "/api/banks/link", tok, `{"bank_code":"apex",`+consent+`}`)
	if code, out := send(h, "POST", "/api/banks/link", tok, `{"bank_code":"apex",`+consent+`}`); code != 409 || errCode(out) != "already_linked" {
		t.Errorf("double link: %d %v", code, out)
	}
	p.SetBankFailure("delta", mock.FailBankDown)
	if code, out := send(h, "POST", "/api/banks/link", tok, `{"bank_code":"delta",`+consent+`}`); code != 502 || errCode(out) != "bank_unavailable" {
		t.Errorf("bank down: %d %v", code, out)
	}
	if code, _ := send(h, "DELETE", "/api/banks/lnk_missing", tok, ""); code != 404 {
		t.Errorf("revoke unknown: %d", code)
	}
}

func TestAccountsShowDownBankAsUnavailable(t *testing.T) {
	h, p := handler()
	p.SetBankFailure("savanna", mock.FailBankDown)
	_, out := send(h, "GET", "/api/accounts", testToken, "")
	if len(out["accounts"].([]any)) != 3 || len(out["unavailable"].([]any)) != 1 {
		t.Fatalf("got %v", out)
	}
}
