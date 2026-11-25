package api

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/categorize"
	"github.com/Mykelsown/apapo/backend/internal/links"
)

// tsFmt has fixed width so timestamps sort correctly as plain strings.
const tsFmt = "2006-01-02T15:04:05.000000000Z07:00"

type feedItem struct {
	ID           string `json:"id"`
	AccountID    string `json:"account_id"`
	BankCode     string `json:"bank_code"`
	BankName     string `json:"bank_name"`
	Direction    string `json:"direction"`
	AmountKobo   int64  `json:"amount_kobo"`
	Narration    string `json:"narration"`
	Counterparty string `json:"counterparty"`
	Category     string `json:"category"`
	Verification string `json:"verification"`
	PostedAt     string `json:"posted_at"`
}

type rawTx struct {
	tx   bank.Transaction
	acct bank.Account
}

// fetchTransactions reads every account's history at once, with a timeout per bank.
func (s *Server) fetchTransactions(ctx context.Context, accounts []bank.Account, from, to time.Time) ([]rawTx, []string) {
	var mu sync.Mutex
	var out []rawTx
	failed := map[string]bool{}
	var wg sync.WaitGroup
	for _, a := range accounts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, cancel := context.WithTimeout(ctx, bankTimeout)
			defer cancel()
			txs, err := s.deps.Provider.GetTransactions(c, a.ID, from, to)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed[a.BankCode] = true
				return
			}
			for _, t := range txs {
				out = append(out, rawTx{t, a})
			}
		}()
	}
	wg.Wait()
	var gaps []string
	for b := range failed {
		gaps = append(gaps, b)
	}
	sort.Strings(gaps)
	return out, gaps
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := 20
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 100 {
			writeError(w, 400, "invalid_query", "limit must be between 1 and 100.", nil)
			return
		}
		limit = n
	}
	days := 60
	if v := q.Get("days"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 90 {
			writeError(w, 400, "invalid_query", "days must be between 1 and 90.", nil)
			return
		}
		days = n
	}
	if c := q.Get("category"); c != "" && !categorize.Valid(c) {
		writeError(w, 400, "invalid_query", "Unknown category.", nil)
		return
	}
	if d := q.Get("direction"); d != "" && d != "credit" && d != "debit" {
		writeError(w, 400, "invalid_query", "direction must be credit or debit.", nil)
		return
	}
	curTime, curID, err := decodeCursor(q.Get("cursor"))
	if err != nil {
		writeError(w, 400, "invalid_query", "Bad cursor.", nil)
		return
	}

	uid := s.currentUserID(r)
	ctx := r.Context()
	active, err := s.deps.Links.Active(ctx, uid)
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	accounts, linkOf, unavailable, err := s.userAccounts(ctx, uid)
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}

	// Per bank cards, including a card for each bank that did not answer.
	down := map[string]bool{}
	for _, u := range unavailable {
		down[u.LinkID] = true
	}
	var total int64
	cards := make([]map[string]any, 0, len(active))
	for _, l := range active {
		card := map[string]any{"link_id": l.ID, "bank_code": l.BankCode, "unavailable": down[l.ID]}
		accs := []accountJSON{}
		var bal int64
		for _, a := range accounts {
			if linkOf[a.ID] == l.ID {
				accs = append(accs, toAccountJSON(a, l.ID))
				bal += a.BalanceKobo
			}
		}
		if !down[l.ID] {
			card["balance_kobo"] = bal
			total += bal
		}
		card["bank_name"] = bankNameFor(s, l)
		card["accounts"] = accs
		cards = append(cards, card)
	}

	now := time.Now().UTC()
	raw, gaps := s.fetchTransactions(ctx, accounts, now.AddDate(0, 0, -days), now.Add(time.Hour))
	txs := make([]bank.Transaction, len(raw))
	for i, x := range raw {
		txs[i] = x.tx
	}
	cats, err := s.deps.Categories.Label(ctx, uid, txs)
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	verif := s.verification(ctx, uid, txs)

	search := strings.ToLower(strings.TrimSpace(q.Get("q")))
	var items []feedItem
	for i, x := range raw {
		it := feedItem{
			ID: x.tx.ID, AccountID: x.acct.ID, BankCode: x.acct.BankCode, BankName: x.acct.BankName,
			Direction: string(x.tx.Direction), AmountKobo: x.tx.AmountKobo, Narration: x.tx.Narration,
			Counterparty: x.tx.Counterparty, Category: cats[i], Verification: verif[i],
			PostedAt: x.tx.PostedAt.UTC().Format(tsFmt),
		}
		if b := q.Get("bank"); b != "" && b != it.BankCode {
			continue
		}
		if c := q.Get("category"); c != "" && c != it.Category {
			continue
		}
		if d := q.Get("direction"); d != "" && d != it.Direction {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(it.Narration+" "+it.Counterparty), search) {
			continue
		}
		items = append(items, it)
	}
	// Newest first; the id breaks ties so paging is stable.
	sort.Slice(items, func(i, j int) bool {
		if items[i].PostedAt != items[j].PostedAt {
			return items[i].PostedAt > items[j].PostedAt
		}
		return items[i].ID > items[j].ID
	})
	if !curTime.IsZero() || curID != "" {
		start := len(items)
		ct := curTime.Format(tsFmt)
		for i, it := range items {
			if it.PostedAt < ct || (it.PostedAt == ct && it.ID < curID) {
				start = i
				break
			}
		}
		items = items[start:]
	}
	next := ""
	if len(items) > limit {
		last := items[limit-1]
		t, _ := time.Parse(tsFmt, last.PostedAt)
		next = encodeCursor(t, last.ID)
		items = items[:limit]
	}
	if items == nil {
		items = []feedItem{}
	}
	if gaps == nil {
		gaps = []string{}
	}
	writeJSON(w, 200, map[string]any{
		"total_balance_kobo": total,
		"banks":              cards,
		"feed":               map[string]any{"items": items, "next_cursor": next, "unavailable_banks": gaps},
	})
}

func bankNameFor(s *Server, l links.Link) string {
	for _, b := range s.deps.Links.Catalog {
		if b.Code == l.BankCode {
			return b.Name
		}
	}
	return l.BankCode
}

// verification marks each transaction confirmed or unverified. Safe Send (B6) supplies
// the real answer; until it is wired in, everything counts as confirmed.
func (s *Server) verification(ctx context.Context, userID string, txs []bank.Transaction) []string {
	if s.deps.Verifier != nil {
		return s.deps.Verifier(ctx, userID, txs)
	}
	out := make([]string, len(txs))
	for i, t := range txs {
		out[i] = "confirmed"
		// A credit the bank has not marked final can still be reversed.
		if t.Direction == bank.Credit && !t.Verified {
			out[i] = "unverified"
		}
	}
	return out
}

func encodeCursor(t time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(tsFmt) + "|" + id))
}

func decodeCursor(c string) (time.Time, string, error) {
	if c == "" {
		return time.Time{}, "", nil
	}
	b, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, "", err
	}
	ts, id, ok := strings.Cut(string(b), "|")
	if !ok {
		return time.Time{}, "", fmt.Errorf("bad cursor")
	}
	t, err := time.Parse(tsFmt, ts)
	return t, id, err
}

type overrideRequest struct {
	Merchant string `json:"merchant"`
	Category string `json:"category"`
}

func (s *Server) setOverride(w http.ResponseWriter, r *http.Request) {
	var req overrideRequest
	if !decode(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Merchant) == "" {
		writeError(w, 400, "invalid_merchant", "Merchant is required.", nil)
		return
	}
	err := s.deps.Categories.Set(r.Context(), s.currentUserID(r), req.Merchant, req.Category)
	if errors.Is(err, categorize.ErrBadCategory) {
		writeError(w, 400, "invalid_category", "Unknown category.", map[string]any{"allowed": categorize.Categories})
		return
	}
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
