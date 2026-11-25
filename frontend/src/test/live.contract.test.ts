/// <reference types="node" />
// @vitest-environment jsdom
//
// Walks the demo path through the real adapter against a running Go backend (mock provider).
// Opt-in so `npm test` stays offline:
//   cd APAPO-backend && make run          (or: cd backend && DEV_OTP=123456 go run ./cmd/api)
//   APAPO_LIVE=1 npm test -- live.contract
// The backend keeps state in memory, so restart it between runs for a clean demo user.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Api } from '../api/client'
import { ApiError } from '../api/errors'
import { session } from '../api/session'
import type { Recipient } from '../api/types'

const LIVE = Boolean(process.env.APAPO_LIVE)
const URL = process.env.APAPO_BACKEND_URL ?? 'http://localhost:8080'
const PHONE = '+2348012345678'
const PIN = '4821'
const BANKS = ['Apex Bank', 'Delta Trust Bank', 'Savanna Bank', 'Harbor MFB']
const CLEAN: Recipient = { bank_code: 'apex', account_number: '1000000001' }
const FLAGGED: Recipient = { bank_code: 'apex', account_number: '9000000001' }

const demoFailure = (body: object) =>
  fetch(`${URL}/api/demo/failure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.get()}` },
    body: JSON.stringify(body),
  })

async function settle(api: Api, id: string) {
  for (let i = 0; i < 20; i++) {
    const s = await api.splitPay.status(id)
    if (['completed', 'rolled_back', 'needs_attention'].includes(s.state)) return s
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('payment did not settle')
}

describe.skipIf(!LIVE)('live backend: demo path through the real adapter', () => {
  let api: Api

  beforeAll(async () => {
    vi.stubEnv('VITE_API_BASE_URL', URL)
    api = (await import('../api/real')).realApi
  })

  it('1. signs in (or onboards a fresh user) and gets a token', async () => {
    try {
      const r = await api.auth.login({ phone: PHONE, pin: PIN })
      expect(r.token).toBeTruthy()
    } catch (e) {
      expect((e as ApiError).code).toBe('INVALID_CREDENTIALS')
      await api.auth.sendOtp(PHONE)
      const v = await api.auth.verifyOtp(PHONE, '123456')
      expect(v.token).toBeTruthy()
      expect((await api.auth.submitBvn('22552255225')).verified).toBe(true)
      expect((await api.auth.setPin({ pin: PIN, confirm_pin: PIN })).status).toBe('set')
    }
    expect(session.get()).toBeTruthy()
    expect(session.getRefresh()).toBeTruthy()
  })

  it('2. rejects a wrong PIN with a normalised error code', async () => {
    await expect(api.auth.login({ phone: PHONE, pin: '0000' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('3. links the four demo banks with consent and lists them', async () => {
    const info = await api.banks.supported()
    expect(info.consent?.duration_days).toBe(90)
    expect(info.banks.filter((b) => !b.supported).every((b) => b.flag === 'coming_soon')).toBe(true)
    for (const name of BANKS) {
      try {
        await api.banks.link({ bank_name: name, consent: true })
      } catch (e) {
        expect((e as ApiError).code).toBe('ALREADY_LINKED')
      }
    }
    const { links } = await api.banks.linked()
    expect(links.map((l) => l.bank_name).sort()).toEqual([...BANKS].sort())
    expect(links[0].scopes).toContain('accounts')
    const { accounts } = await api.accounts.list()
    expect(accounts).toHaveLength(4)
    expect(accounts[0].masked_number).toMatch(/\*/)
  })

  it('4. builds the dashboard in the app shape', async () => {
    const d = await api.dashboard.get()
    expect(d.bank_cards).toHaveLength(4)
    expect(d.total_balance_kobo).toBeGreaterThan(0)
    expect(d.transaction_feed.length).toBeGreaterThan(0)
    const debit = d.transaction_feed.find((t) => t.direction === 'outgoing')
    expect(debit && debit.amount_kobo < 0).toBe(true)
    expect(d.transaction_feed.some((t) => t.verification === 'unverified')).toBe(true)
    expect(d.transaction_feed.every((t) => /^[A-Z]/.test(t.category))).toBe(true)
  })

  it('5. shows the Safe Send risk tiers', async () => {
    const high = await api.splitPay.preview({ amount_kobo: 100_000, recipient: FLAGGED })
    expect(high.risk_tier).toBe('high')
    expect(high.reasons?.length).toBeGreaterThan(0)
    const clean = await api.splitPay.preview({ amount_kobo: 100_000, recipient: CLEAN })
    expect(clean.risk_tier).not.toBe('high')
  })

  it('6. forced failure rolls the payment back', async () => {
    expect((await demoFailure({ account_id: 'acc_savanna_1', mode: 'bank_down' })).ok).toBe(true)
    try {
      const ex = await api.splitPay.execute({ amount_kobo: 15_000_000, recipient: CLEAN, pin: PIN }, `live-rb-${Date.now()}`)
      const s = await settle(api, ex.payment_id)
      expect(s.state).toBe('rolled_back')
      expect(s.message).toMatch(/money is back/i)
      expect(s.legs.some((l) => l.state === 'reversed')).toBe(true)
      expect(s.legs.every((l) => l.bank_name)).toBe(true)
    } finally {
      await demoFailure({ account_id: 'acc_savanna_1', mode: 'none' })
    }
  })

  it('7. pays N150,000 across three accounts, enforces the PIN, and is idempotent', async () => {
    await expect(
      api.splitPay.execute({ amount_kobo: 15_000_000, recipient: CLEAN, pin: '0000' }, `live-bad-${Date.now()}`),
    ).rejects.toMatchObject({ code: 'INVALID_PIN' })

    const key = `live-ok-${Date.now()}`
    const pv = await api.splitPay.preview({ amount_kobo: 15_000_000, recipient: CLEAN })
    expect(pv.legs.length).toBe(3)
    expect(pv.legs.reduce((s, l) => s + l.amount_kobo, 0)).toBe(15_000_000)

    const ex = await api.splitPay.execute({ amount_kobo: 15_000_000, recipient: CLEAN, pin: PIN }, key)
    const s = await settle(api, ex.payment_id)
    expect(s.state).toBe('completed')
    expect(s.legs.every((l) => l.state === 'collected')).toBe(true)

    const again = await api.splitPay.execute({ amount_kobo: 15_000_000, recipient: CLEAN, pin: PIN }, key)
    expect(again.payment_id).toBe(ex.payment_id)
  })

  it('8. warns about an unconfirmed credit before it is sent on', async () => {
    const r = await api.safeSend.shieldCheck(7_800_000)
    expect(r.alert?.credit_id).toBeTruthy()
    expect(r.alert?.message).toMatch(/not been confirmed/i)
  })

  it('9. splits an incoming credit and the ledger balances', async () => {
    const { accounts } = await api.accounts.list()
    const id = (code: string) => accounts.find((a) => a.bank_code === code)!.account_id
    const { rules } = await api.splitReceive.setRules({
      receiving_account_id: id('apex'),
      destinations: [
        { account_id: id('delta'), percent: 30 },
        { account_id: id('harbor'), percent: 20 },
      ],
      standing_consent: true,
      pin: PIN,
    })
    expect(rules.active).toBe(true)
    const sim = await api.splitReceive.simulateCredit({ amount_kobo: 10_000_000, sender_name: 'Ada Stores' })
    expect(sim.scan?.new_runs.length).toBe(1)
    const { runs } = await api.splitReceive.runs(5)
    expect(runs[0].state).toBe('settled')
    const rec = await api.splitReceive.reconciliation()
    expect(rec.credits.every((c) => c.balanced)).toBe(true)
    expect(rec.totals.sent_kobo + rec.totals.held_kobo + rec.totals.kept_kobo).toBe(rec.totals.credit_kobo)
  })

  it('10. reads and changes the daily limit with the PIN', async () => {
    const before = await api.security.getLimits()
    expect(before.remaining_kobo).toBeLessThanOrEqual(before.daily_limit_kobo)
    await expect(api.security.setLimits({ daily_limit_kobo: 50_000_000 }, '0000')).rejects.toBeInstanceOf(ApiError)
    await api.security.setLimits({ daily_limit_kobo: before.daily_limit_kobo }, PIN)
    expect((await api.security.getLimits()).daily_limit_kobo).toBe(before.daily_limit_kobo)
  })

  it('11. lists sessions and an audit trail', async () => {
    const sessions = await api.security.sessions()
    expect(sessions.some((s) => s.current)).toBe(true)
    const audit = await api.security.audit()
    expect(audit.length).toBeGreaterThan(0)
    expect(audit[0]).toMatchObject({ action: expect.any(String), timestamp: expect.any(String) })
  })

  it('12. refreshes an expired access token once and carries on', async () => {
    const refreshBefore = session.getRefresh()
    session.set('definitely-not-a-valid-token')
    const d = await api.dashboard.get()
    expect(d.bank_cards.length).toBe(4)
    expect(session.get()).not.toBe('definitely-not-a-valid-token')
    expect(session.getRefresh()).not.toBe(refreshBefore)
  })

  it('13. signs out everywhere', async () => {
    expect((await api.security.logoutAll()).status).toBe('logged_out')
    await expect(api.dashboard.get()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})
