package mock

import (
	"fmt"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/bank"
)

const DemoUserID = "usr_demo"
const DemoUserID2 = "usr_demo2"

// Fake banks. Names are invented on purpose so the mock never implies a real bank.
var Banks = []struct{ Code, Name string }{
	{"apex", "Apex Bank"},
	{"delta", "Delta Trust Bank"},
	{"savanna", "Savanna Bank"},
	{"harbor", "Harbor MFB"},
}

var defaultBalances = map[string]bank.Kobo{
	"apex":    7_000_000, // N70,000
	"delta":   6_000_000, // N60,000
	"savanna": 4_500_000, // N45,000
	"harbor":  2_000_000, // N20,000
}

func bankIndex(code string) int {
	for i, b := range Banks {
		if b.Code == code {
			return i
		}
	}
	return -1
}

// Seed fills the provider with the demo user: four banks whose balances force a
// three way split for N150,000, and 60 days of history with a transport spend
// shift of exactly 40 percent (N30,000 to N42,000) and a food decrease.
func Seed(p *Provider) {
	for _, b := range Banks {
		p.SeedBank(DemoUserID, b.Code, "acc_"+b.Code+"_1")
	}
	p.SeedBank(DemoUserID2, "apex", "acc_demo2_apex_1")
}

// SeedBank gives a user one account at a bank, with a balance and 60 days of history.
// It does nothing if the user already has an account there.
func (p *Provider) SeedBank(userID, bankCode, accountID string) {
	i := bankIndex(bankCode)
	if i < 0 {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, a := range p.accounts {
		if a.UserID == userID && a.BankCode == bankCode {
			return
		}
	}
	p.accounts[accountID] = &bank.Account{
		ID: accountID, UserID: userID, BankCode: bankCode, BankName: Banks[i].Name,
		AccountName:   "Samuel Pelumi",
		AccountNumber: fmt.Sprintf("00%d4%d7%d2%d1", i+1, i+2, i+3, i+4),
		BalanceKobo:   defaultBalances[bankCode],
	}
	now := p.now().UTC()
	add := func(daysAgo int, dir bank.Direction, amount bank.Kobo, narration, cp string) {
		n := p.seedSeq
		p.seedSeq++
		p.txns[accountID] = append(p.txns[accountID], bank.Transaction{
			ID: fmt.Sprintf("seed_txn_%s_%04d", accountID, n), AccountID: accountID, Direction: dir, AmountKobo: amount,
			Narration: narration, Counterparty: cp, Reference: fmt.Sprintf("seed_ref_%s_%04d", accountID, n),
			PostedAt: now.AddDate(0, 0, -daysAgo).Add(-time.Duration(n%9) * time.Hour), Verified: true,
		})
	}
	for d := 0; d < 60; d++ {
		current := d < 30
		switch bankCode {
		case "apex": // transport: 14 trips this period, 10 the period before
			if (current && d%2 == 0 && d < 28) || (!current && d%3 == 0) {
				add(d, bank.Debit, 300_000, "BOLT RIDE LAGOS", "Bolt")
			}
		case "delta": // food: 6 meals this period, 12 the period before
			if (current && d%5 == 1) || (!current && d%2 == 1 && d < 54) {
				add(d, bank.Debit, 250_000, "CHICKEN REPUBLIC IKEJA", "Chicken Republic")
			}
		case "savanna": // weekly customer credits
			if d%7 == 3 {
				add(d, bank.Credit, 2_500_000, "POS SETTLEMENT", "Customer POS")
			}
		case "harbor": // monthly data bundle
			if d == 4 || d == 34 {
				add(d, bank.Debit, 500_000, "MTN DATA BUNDLE", "MTN")
			}
		}
	}
}
