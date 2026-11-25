package api

import (
	"encoding/json"
	"net/http"

	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
)

// demoFailure lets the frontend force a bank failure so the rollback screen can be
// shown live. Mock mode only: the route does not exist with the real provider.
// Body: {"account_id" or "bank_code", "mode": "timeout|insufficient_funds|bank_down|reversal_down|none"}.
// reversal_down needs bank_code: reversals touching that bank fail while normal
// transfers keep working, so a stuck reversal can be shown and then cleared with none.
func (s *Server) demoFailure(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AccountID string `json:"account_id"`
		BankCode  string `json:"bank_code"`
		Mode      string `json:"mode"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<12)).Decode(&req); err != nil || (req.AccountID == "") == (req.BankCode == "") {
		writeError(w, http.StatusBadRequest, "invalid_request", "Send exactly one of account_id or bank_code, plus a mode.", nil)
		return
	}
	if req.Mode == "reversal_down" {
		if req.BankCode == "" {
			writeError(w, http.StatusBadRequest, "invalid_request", "reversal_down needs a bank_code.", nil)
			return
		}
		s.deps.Mock.SetBankReversalFailure(req.BankCode, true)
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	mode := mock.Failure(req.Mode)
	switch mode {
	case "none":
		mode = mock.FailNone
		if req.BankCode != "" {
			s.deps.Mock.SetBankReversalFailure(req.BankCode, false)
		}
	case mock.FailTimeout, mock.FailInsufficientFunds, mock.FailBankDown:
	default:
		writeError(w, http.StatusBadRequest, "invalid_mode", "Mode must be timeout, insufficient_funds, bank_down, reversal_down or none.", nil)
		return
	}
	if req.AccountID != "" {
		s.deps.Mock.SetAccountFailure(req.AccountID, mode)
	} else {
		s.deps.Mock.SetBankFailure(req.BankCode, mode)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
