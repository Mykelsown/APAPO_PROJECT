package api

import "testing"

const srRules = `{"receiving_account_id":"acc_apex_1","standing_consent":true,"pin":"4821","destinations":[
 {"account_id":"acc_delta_1","percent":30},
 {"beneficiary":{"bank_code":"savanna","account_number":"0123456789","account_name":"Mama"},"fixed_kobo":500000}]}`

func TestSplitReceiveRulesRequireConsentAndPIN(t *testing.T) {
	h, _ := handler()
	if code, out := send(h, "PUT", "/api/splitreceive/rules", testToken, `{"receiving_account_id":"acc_apex_1","pin":"4821","destinations":[{"account_id":"acc_delta_1","percent":10}]}`); code != 400 || errCode(out) != "consent_required" {
		t.Fatalf("no consent: %d %v", code, out)
	}
	if code, _ := send(h, "PUT", "/api/splitreceive/rules", testToken, `{"receiving_account_id":"acc_apex_1","standing_consent":true,"pin":"0000","destinations":[{"account_id":"acc_delta_1","percent":10}]}`); code == 200 {
		t.Fatal("wrong PIN accepted")
	}
	if code, out := send(h, "PUT", "/api/splitreceive/rules", testToken, srRules); code != 200 {
		t.Fatalf("valid rules: %d %v", code, out)
	}
	code, out := send(h, "GET", "/api/splitreceive/rules", testToken, "")
	if code != 200 || out["rules"].(map[string]any)["active"] != true {
		t.Fatalf("get rules %d %v", code, out)
	}
}

func TestSplitReceiveEndToEndAndReconciliation(t *testing.T) {
	h, _ := handler()
	send(h, "PUT", "/api/splitreceive/rules", testToken, srRules)

	// An unverified credit must not be split.
	code, out := send(h, "POST", "/api/demo/simulate-credit", testToken, `{"amount_kobo":1000000,"verified":false}`)
	if code != 201 || len(out["scan"].(map[string]any)["new_runs"].([]any)) != 0 {
		t.Fatalf("unverified: %d %v", code, out)
	}
	// A verified one is.
	code, out = send(h, "POST", "/api/demo/simulate-credit", testToken, `{"amount_kobo":1000000}`)
	runs := out["scan"].(map[string]any)["new_runs"].([]any)
	if code != 201 || len(runs) != 1 {
		t.Fatalf("verified: %d %v", code, out)
	}
	code, run := send(h, "GET", "/api/splitreceive/runs/"+runs[0].(string), testToken, "")
	if code != 200 || run["state"] != "settled" || len(run["legs"].([]any)) != 2 {
		t.Fatalf("run %d %v", code, run)
	}
	// A second scan finds nothing new.
	_, scan := send(h, "POST", "/api/splitreceive/scan", testToken, "")
	if len(scan["new_runs"].([]any)) != 0 {
		t.Fatalf("duplicate split: %v", scan)
	}
	code, rec := send(h, "GET", "/api/reconciliation", testToken, "")
	if code != 200 {
		t.Fatalf("recon %d %v", code, rec)
	}
	for _, c := range rec["credits"].([]any) {
		if c.(map[string]any)["balanced"] != true {
			t.Fatalf("unbalanced ledger entry %v", c)
		}
	}
	if rec["totals"].(map[string]any)["credit_kobo"].(float64) != 1000000 {
		t.Fatalf("totals %v", rec["totals"])
	}
	if code, _ := send(h, "DELETE", "/api/splitreceive/rules", testToken, ""); code != 200 {
		t.Fatal("disable")
	}
	if code, out := send(h, "POST", "/api/splitreceive/scan", testToken, ""); code != 409 || errCode(out) != "no_active_rules" {
		t.Fatalf("scan after disable %d %v", code, out)
	}
}
