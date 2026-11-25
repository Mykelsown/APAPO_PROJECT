import { beforeAll, describe, expect, it } from 'vitest'
import { api } from '../api/client'
import { session } from '../api/session'

describe('Split-Receive & Settlement Ledger', () => {
  beforeAll(() => {
    session.set('mock-token')
  })
  it('retrieves active Split-Receive rules', async () => {
    const res = await api.splitReceive.getRules()
    expect(res.rules).not.toBeNull()
    if (res.rules) {
      expect(res.rules.receiving_account_id).toBeDefined()
      expect(res.rules.destinations.length).toBeGreaterThan(0)
    }
  })

  it('rejects rules where total percentage exceeds 100%', async () => {
    await expect(
      api.splitReceive.setRules({
        receiving_account_id: 'ACCT-001',
        destinations: [
          { account_id: 'ACCT-002', percent: 60 },
          { account_id: 'ACCT-003', percent: 50 }, // Total = 110%
        ],
        standing_consent: true,
        pin: '1234',
      }),
    ).rejects.toThrow()
  })

  it('verifies that Sent + Held + Kept equals Total Credited in settlement ledger', async () => {
    const rec = await api.splitReceive.reconciliation()
    expect(rec.credits.length).toBeGreaterThan(0)

    for (const credit of rec.credits) {
      const sum = credit.sent_kobo + credit.held_kobo + credit.kept_kobo
      expect(sum).toBe(credit.amount_kobo)
      expect(credit.balanced).toBe(true)
    }

    const { totals } = rec
    expect(totals.sent_kobo + totals.held_kobo + totals.kept_kobo).toBe(totals.credit_kobo)
  })

  it('simulates an incoming credit and automatically executes active split rules', async () => {
    const amountKobo = 10_000_000 // ₦100,000
    const sim = await api.splitReceive.simulateCredit({
      amount_kobo: amountKobo,
      sender_name: 'Test Customer',
      verified: true,
    })

    expect(sim.credit.amount_kobo).toBe(amountKobo)
    expect(sim.credit.verified).toBe(true)
    expect(sim.scan?.new_runs.length).toBeGreaterThan(0)
  })

  it('safely ignores unverified credits during scan', async () => {
    const amountKobo = 8_000_000 // ₦80,000
    const sim = await api.splitReceive.simulateCredit({
      amount_kobo: amountKobo,
      sender_name: 'Suspicious Sender',
      verified: false,
    })

    expect(sim.credit.verified).toBe(false)
    expect(sim.scan?.ignored_unverified).toBe(1)
  })
})
