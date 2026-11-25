package api

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
)

func getDash(t *testing.T, h http.Handler, query string) (int, map[string]any) {
	t.Helper()
	return send(h, "GET", "/api/dashboard"+query, testToken, "")
}

func feedOf(out map[string]any) ([]any, string) {
	f := out["feed"].(map[string]any)
	next, _ := f["next_cursor"].(string)
	return f["items"].([]any), next
}

func TestDashboardTotalsCardsAndFeed(t *testing.T) {
	h, _ := handler()
	code, out := getDash(t, h, "?limit=100")
	if code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	if out["total_balance_kobo"].(float64) != 19_500_000 || len(out["banks"].([]any)) != 4 {
		t.Fatalf("totals %v", out["total_balance_kobo"])
	}
	items, next := feedOf(out)
	if next != "" || len(items) == 0 {
		t.Fatalf("feed %d next %q", len(items), next)
	}
	prev := ""
	for _, x := range items {
		it := x.(map[string]any)
		if prev != "" && it["posted_at"].(string) > prev {
			t.Fatal("feed is not newest first")
		}
		prev = it["posted_at"].(string)
		if it["verification"] != "confirmed" || it["category"] == "" || it["bank_name"] == "" {
			t.Fatalf("row %v", it)
		}
	}
}

func TestDashboardPaginationWalksEveryRowOnce(t *testing.T) {
	h, _ := handler()
	_, all := getDash(t, h, "?limit=100")
	want, _ := feedOf(all)
	seen := map[string]bool{}
	cursor, pages := "", 0
	for {
		q := "?limit=7"
		if cursor != "" {
			q += "&cursor=" + url.QueryEscape(cursor)
		}
		_, out := getDash(t, h, q)
		items, next := feedOf(out)
		for _, x := range items {
			id := x.(map[string]any)["id"].(string)
			if seen[id] {
				t.Fatalf("row %s repeated", id)
			}
			seen[id] = true
		}
		pages++
		if next == "" {
			break
		}
		cursor = next
		if pages > 50 {
			t.Fatal("pagination never ends")
		}
	}
	if len(seen) != len(want) || pages < 2 {
		t.Fatalf("saw %d of %d rows in %d pages", len(seen), len(want), pages)
	}
}

func TestDashboardFilters(t *testing.T) {
	h, _ := handler()
	_, out := getDash(t, h, "?bank=apex&limit=100")
	items, _ := feedOf(out)
	if len(items) == 0 {
		t.Fatal("no apex rows")
	}
	for _, x := range items {
		if x.(map[string]any)["bank_code"] != "apex" {
			t.Fatal("bank filter leaked")
		}
	}
	_, out = getDash(t, h, "?q=chicken&limit=100")
	items, _ = feedOf(out)
	if len(items) == 0 || items[0].(map[string]any)["category"] != "food" {
		t.Fatalf("search/category: %v", items)
	}
	_, out = getDash(t, h, "?category=income&direction=credit&limit=100")
	items, _ = feedOf(out)
	if len(items) == 0 {
		t.Fatal("no income rows")
	}
	for _, q := range []string{"?limit=0", "?limit=999", "?days=500", "?category=zzz", "?direction=up", "?cursor=!!"} {
		if code, _ := getDash(t, h, q); code != 400 {
			t.Errorf("%s should be 400, got %d", q, code)
		}
	}
}

func TestDashboardSurvivesOneBankDown(t *testing.T) {
	h, p := handler()
	p.SetBankFailure("delta", mock.FailBankDown)
	code, out := getDash(t, h, "?limit=100")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	if out["total_balance_kobo"].(float64) != 13_500_000 {
		t.Fatalf("total should exclude the down bank: %v", out["total_balance_kobo"])
	}
	downCards := 0
	for _, c := range out["banks"].([]any) {
		card := c.(map[string]any)
		if card["unavailable"] == true {
			downCards++
			if card["bank_code"] != "delta" || card["balance_kobo"] != nil {
				t.Fatalf("bad down card %v", card)
			}
		}
	}
	items, _ := feedOf(out)
	if downCards != 1 || len(items) == 0 {
		t.Fatalf("down cards %d rows %d", downCards, len(items))
	}
}

func TestCategoryOverride(t *testing.T) {
	h, _ := handler()
	if code, _ := send(h, "PUT", "/api/categories/override", testToken, `{"merchant":"Bolt","category":"shopping"}`); code != 200 {
		t.Fatal(code)
	}
	_, out := getDash(t, h, "?q=bolt&limit=100")
	items, _ := feedOf(out)
	for _, x := range items {
		if x.(map[string]any)["category"] != "shopping" {
			t.Fatalf("override not applied: %v", x)
		}
	}
	if code, out := send(h, "PUT", "/api/categories/override", testToken, `{"merchant":"Bolt","category":"nope"}`); code != 400 || errCode(out) != "invalid_category" {
		t.Fatalf("%d %v", code, out)
	}
	if code, _ := send(h, "PUT", "/api/categories/override", testToken, `{"merchant":" ","category":"food"}`); code != 400 {
		t.Fatal(code)
	}
}
