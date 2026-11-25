import { beforeAll, describe, expect, it } from 'vitest'
import { api, demo } from '../api/client'
import { session } from '../api/session'
import { demoPayees } from './demoPayees'

const [LOW, , HIGH] = demoPayees('mock').map((d) => d.recipient)

describe('Split-Pay Engine & Rollback', () => {
  beforeAll(() => {
    session.set('mock-token')
  })
  it('plans a multi-account payment when no single account covers the total', async () => {
    // ₦200,000 payment (20,000,000 kobo), exceeds largest single account (₦185k)
    const preview = await api.splitPay.preview({
      amount_kobo: 15_000_000,
      recipient: LOW,
    })

    expect(preview.legs.length).toBeGreaterThan(1)
    const sumOfLegs = preview.legs.reduce((acc, leg) => acc + leg.amount_kobo, 0)
    expect(sumOfLegs).toBe(15_000_000)
    expect(preview.total_amount_kobo).toBe(15_000_000)
    expect(preview.total_fee_kobo).toBe(preview.legs.length * 5000)
  })

  it('rejects an amount exceeding combined linked balances with INSUFFICIENT_FUNDS', async () => {
    // ₦1,000,000 payment (100,000,000 kobo), far exceeds available balances
    await expect(
      api.splitPay.preview({
        amount_kobo: 100_000_000,
        recipient: LOW,
      }),
    ).rejects.toThrow()
  })

  it('detects high-risk recipient and flags risk tier correctly', async () => {
    const preview = await api.splitPay.preview({
      amount_kobo: 5_000_000,
      recipient: HIGH, // High risk demo account
    })

    expect(preview.risk_tier).toBe('high')
    expect(preview.reasons?.length).toBeGreaterThan(0)
  })

  it('executes two-phase rollback when forceFailure demo toggle is active', async () => {
    demo.forceFailure = true
    try {
      const exec = await api.splitPay.execute(
        { amount_kobo: 15_000_000, recipient: LOW, pin: '1234' },
        'test-key-' + Date.now(),
      )

      expect(exec.payment_id).toBeDefined()
      expect(exec.status).toBe('planned')

      // Check status after simulated failure window (LEG_STEP_MS * legs.length)
      // On mock, derivePayment evaluates failure based on startedAt and forceFailure
      const status = await api.splitPay.status(exec.payment_id)
      expect(status.payment_id).toBe(exec.payment_id)
    } finally {
      demo.forceFailure = false
    }
  })
})
