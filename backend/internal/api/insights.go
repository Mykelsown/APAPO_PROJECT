package api

import (
	"net/http"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/insights"
)

// shifts answers "why did my spending change": this month so far against the same
// days of last month, per category, with the facts behind each change.
func (s *Server) insightShifts(w http.ResponseWriter, r *http.Request) {
	uid := s.currentUserID(r)
	ctx := r.Context()
	accounts, _, _, err := s.userAccounts(ctx, uid)
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	now := time.Now()
	cur, prev := insights.Windows(now)
	_ = cur
	raw, gaps := s.fetchTransactions(ctx, accounts, prev.From.UTC(), now.Add(time.Hour))
	txs := make([]bank.Transaction, len(raw))
	for i, x := range raw {
		txs[i] = x.tx
	}
	cats, err := s.deps.Categories.Label(ctx, uid, txs)
	if err != nil {
		writeError(w, 500, "internal_error", "Something went wrong.", nil)
		return
	}
	in := make([]insights.Tx, len(txs))
	for i, t := range txs {
		in[i] = insights.Tx{ID: t.ID, Counterparty: t.Counterparty, AmountKobo: t.AmountKobo, At: t.PostedAt, Category: cats[i], Debit: t.Direction == bank.Debit}
	}
	shifts := insights.Shifts(in, now)
	if shifts == nil {
		shifts = []insights.Shift{}
	}
	writeJSON(w, 200, map[string]any{
		"shifts": shifts, "partial": len(gaps) > 0,
		"current_window": cur, "previous_window": prev,
	})
}
