package mock

import (
	"context"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
)

// DemoRecipient is a made up payee for demos of Safe Send.
type DemoRecipient struct {
	BankCode, AccountNumber, Name, Kind string // Kind: flagged, clean or unknown
}

// DemoRecipients: five that scammers use (flagged), five normal ones (clean), five the
// bank cannot name (unknown). All fictional.
var DemoRecipients = []DemoRecipient{
	{"apex", "9000000001", "Quick Returns Investments", "flagged"},
	{"delta", "9000000002", "Double Your Naira Ltd", "flagged"},
	{"savanna", "9000000003", "Crypto Doubler Hub", "flagged"},
	{"harbor", "9000000004", "Grant Claim Office", "flagged"},
	{"apex", "9000000005", "Loan Processing Desk", "flagged"},
	{"apex", "1000000001", "Ada Okafor", "clean"},
	{"delta", "1000000002", "Emeka Nwosu", "clean"},
	{"savanna", "1000000003", "Fatima Bello", "clean"},
	{"harbor", "1000000004", "Tunde Bakare", "clean"},
	{"apex", "1000000005", "Mama Chidi Provisions", "clean"},
	{"delta", "2000000001", "", "unknown"},
	{"savanna", "2000000002", "", "unknown"},
	{"harbor", "2000000003", "", "unknown"},
	{"apex", "2000000004", "", "unknown"},
	{"delta", "2000000005", "", "unknown"},
}

// ResolveName is the mock name enquiry. Unknown accounts return false.
func (p *Provider) ResolveName(ctx context.Context, bankCode, accountNumber string) (string, bool) {
	for _, r := range DemoRecipients {
		if r.BankCode == bankCode && r.AccountNumber == accountNumber && r.Name != "" {
			return r.Name, true
		}
	}
	return "", false
}

// SeedUnverifiedCredit puts a N80,000 credit from yesterday into the demo user's first
// account that the bank has not confirmed. It is not in the available balance until confirmed. This is the setup for the Shield demo.
func SeedUnverifiedCredit(p *Provider) {
	p.mu.Lock()
	a, ok := p.accounts["acc_apex_1"]
	if !ok {
		p.mu.Unlock()
		return
	}
	t := bank.Transaction{
		ID: p.nextID("txn"), AccountID: a.ID, Direction: bank.Credit, AmountKobo: 8_000_000,
		Narration: "NIP CREDIT FROM Chuka Ventures", Counterparty: "Chuka Ventures", Reference: p.nextID("nip"),
		PostedAt: p.now().UTC().Add(-24 * time.Hour).Add(2 * time.Hour), Verified: false,
	}
	p.txns[a.ID] = append(p.txns[a.ID], t)
	p.mu.Unlock()
}
