package api

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/links"
)

const bankTimeout = 3 * time.Second

type accountJSON struct {
	ID            string `json:"id"`
	LinkID        string `json:"link_id"`
	BankCode      string `json:"bank_code"`
	BankName      string `json:"bank_name"`
	AccountName   string `json:"account_name"`
	AccountNumber string `json:"account_number"`
	BalanceKobo   int64  `json:"balance_kobo"`
}

type unavailableBank struct {
	BankCode string `json:"bank_code"`
	LinkID   string `json:"link_id"`
}

// userAccounts reads accounts from every active link at once. A slow or failing
// bank is reported as unavailable and never blocks the others.
func (s *Server) userAccounts(ctx context.Context, userID string) (accounts []bank.Account, linkOf map[string]string, unavailable []unavailableBank, err error) {
	active, err := s.deps.Links.Active(ctx, userID)
	if err != nil {
		return nil, nil, nil, err
	}
	type result struct {
		link links.Link
		accs []bank.Account
		err  error
	}
	results := make([]result, len(active))
	var wg sync.WaitGroup
	for i, l := range active {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, cancel := context.WithTimeout(ctx, bankTimeout)
			defer cancel()
			a, e := s.deps.Linker.AccountsAt(c, userID, l.BankCode)
			results[i] = result{l, a, e}
		}()
	}
	wg.Wait()
	linkOf = map[string]string{}
	for _, r := range results {
		if r.err != nil {
			unavailable = append(unavailable, unavailableBank{r.link.BankCode, r.link.ID})
			continue
		}
		for _, a := range r.accs {
			accounts = append(accounts, a)
			linkOf[a.ID] = r.link.ID
		}
	}
	sort.Slice(accounts, func(i, j int) bool { return accounts[i].ID < accounts[j].ID })
	return accounts, linkOf, unavailable, nil
}

func (s *Server) supportedBanks(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"banks": s.deps.Links.Catalog,
		"consent": map[string]any{
			"scopes":        links.Scopes,
			"duration_days": links.ConsentDays,
			"required":      []string{"accounts"},
		},
	})
}

func (s *Server) linkBank(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BankCode string `json:"bank_code"`
		Consent  struct {
			Accepted bool     `json:"accepted"`
			Scopes   []string `json:"scopes"`
		} `json:"consent"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !req.Consent.Accepted {
		writeError(w, 400, "consent_required", "You need to agree to share this data before linking.", nil)
		return
	}
	uid := s.currentUserID(r)
	l, err := s.deps.Links.Link(r.Context(), uid, req.BankCode, req.Consent.Scopes)
	switch {
	case errors.Is(err, bank.ErrUnsupportedBank):
		writeError(w, 422, "bank_not_supported", "That bank is not supported yet.", nil)
		return
	case errors.Is(err, links.ErrBadConsent):
		writeError(w, 400, "invalid_consent", "Consent must include accounts and only known scopes.", nil)
		return
	case errors.Is(err, links.ErrAlreadyLinked):
		writeError(w, 409, "already_linked", "That bank is already linked.", nil)
		return
	case errors.Is(err, bank.ErrBankUnavailable), errors.Is(err, bank.ErrTimeout):
		writeError(w, 502, "bank_unavailable", "That bank is not responding. Try again shortly.", nil)
		return
	case err != nil:
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	accs, linkOf, _, _ := s.userAccounts(r.Context(), uid)
	var mine []accountJSON
	for _, a := range accs {
		if linkOf[a.ID] == l.ID {
			mine = append(mine, toAccountJSON(a, l.ID))
		}
	}
	writeJSON(w, 201, map[string]any{"link": linkJSON(l), "accounts": mine})
}

func linkJSON(l links.Link) map[string]any {
	return map[string]any{
		"id": l.ID, "bank_code": l.BankCode, "scopes": l.Scopes,
		"consent_at": l.ConsentAt.Format(time.RFC3339), "consent_expires_at": l.ConsentExpiresAt.Format(time.RFC3339),
	}
}

func toAccountJSON(a bank.Account, linkID string) accountJSON {
	return accountJSON{a.ID, linkID, a.BankCode, a.BankName, a.AccountName, maskAccount(a.AccountNumber), a.BalanceKobo}
}

func (s *Server) listAccounts(w http.ResponseWriter, r *http.Request) {
	accs, linkOf, unavailable, err := s.userAccounts(r.Context(), s.currentUserID(r))
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	out := make([]accountJSON, 0, len(accs))
	for _, a := range accs {
		out = append(out, toAccountJSON(a, linkOf[a.ID]))
	}
	if unavailable == nil {
		unavailable = []unavailableBank{}
	}
	writeJSON(w, 200, map[string]any{"accounts": out, "unavailable": unavailable})
}

func (s *Server) linkedBanks(w http.ResponseWriter, r *http.Request) {
	active, err := s.deps.Links.Active(r.Context(), s.currentUserID(r))
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	out := make([]map[string]any, 0, len(active))
	for _, l := range active {
		out = append(out, linkJSON(l))
	}
	writeJSON(w, 200, map[string]any{"links": out})
}

func (s *Server) revokeBank(w http.ResponseWriter, r *http.Request) {
	err := s.deps.Links.Revoke(r.Context(), s.currentUserID(r), r.PathValue("id"))
	if errors.Is(err, links.ErrNotFound) {
		writeError(w, 404, "not_found", "Linked bank not found.", nil)
		return
	}
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "revoked"})
}
