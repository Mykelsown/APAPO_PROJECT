package api

import "testing"

func TestInsightShiftsFromSeedData(t *testing.T) {
	h, _ := handler()
	code, out := send(h, "GET", "/api/insights/shifts", testToken, "")
	if code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	if _, ok := out["shifts"].([]any); !ok {
		t.Fatalf("shifts must be a list: %v", out)
	}
	for _, x := range out["shifts"].([]any) {
		s := x.(map[string]any)
		if s["summary"] == "" || len(s["supporting_transaction_ids"].([]any)) == 0 || s["change_pct"].(float64) < 20 {
			t.Fatalf("weak shift %v", s)
		}
	}
	t.Logf("%d shifts on today's data", len(out["shifts"].([]any)))
}
