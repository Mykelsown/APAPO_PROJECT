// @vitest-environment jsdom
//
// End-to-end test of the demo path through the real screens, running on the in-browser mock:
// dashboard -> Split-Pay across several banks -> receipt, the high-risk gate, and the rollback.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { demo } from '../api/client'
import { session } from '../api/session'
import { renderApp, SLOW } from './renderApp'

async function startPayment(user: ReturnType<typeof userEvent.setup>, amount: string, payee: RegExp) {
  await user.type(await screen.findByLabelText(/transfer amount/i, {}, SLOW), amount)
  // The bank list loads asynchronously; the payee chip fills the bank and account number once it is there.
  await screen.findByRole('option', { name: /access bank/i }, SLOW)
  await user.click(screen.getByRole('button', { name: payee }))
  await user.click(screen.getByRole('button', { name: /calculate split-pay plan/i }))
  await screen.findByText(/paid from \d accounts?/i, {}, SLOW)
}

async function enterPinAndPay(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /confirm with pin/i }))
  await user.click(await screen.findByRole('button', { name: /use keyboard/i }))
  await user.type(screen.getByLabelText(/security pin/i), '1234')
  await user.click(screen.getByRole('button', { name: /pay now/i }))
}

describe('demo path (mock mode)', () => {
  beforeEach(() => {
    session.set('mock-token')
    try {
      localStorage.clear()
    } catch {
      // storage unavailable
    }
  })
  afterEach(() => {
    cleanup()
    demo.forceFailure = false
  })

  it('shows one balance, a card per bank, and flags the unverified credit', async () => {
    renderApp('/')
    expect(await screen.findByText(/total combined balance/i, {}, SLOW)).toBeInTheDocument()
    expect((await screen.findAllByText('₦195,000.00')).length).toBeGreaterThan(0)
    for (const bank of ['Access Bank', 'GTBank', 'Zenith Bank', 'UBA']) {
      expect(screen.getAllByText(bank).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText(/unverified credit\. potential scam or reversal/i).length).toBeGreaterThan(0)
  }, 30_000)

  it('pays an amount no single account covers, across three banks, and shows a receipt', async () => {
    const user = userEvent.setup()
    renderApp('/pay')
    await startPayment(user, '150000', /ada n\./i)

    expect(screen.getByText(/paid from 3 accounts/i)).toBeInTheDocument()
    expect(screen.getByText(/low risk/i)).toBeInTheDocument()

    await enterPinAndPay(user)
    // "Payment sent." also shows briefly as the progress message, so wait for the receipt screen itself.
    expect(await screen.findByRole('heading', { name: 'Payment sent' }, { timeout: 30_000 })).toBeInTheDocument()
    const receipt = screen.getByRole('heading', { name: 'Receipt' }).closest('.space-y-4 > *') as HTMLElement
    const lines = within(receipt)
    expect(lines.getByText('Total charged').nextElementSibling).toHaveTextContent('₦150,')
    for (const bank of ['Access Bank', 'GTBank', 'Zenith Bank']) {
      expect(lines.getByText(bank)).toBeInTheDocument()
    }
  }, 60_000)

  it('blocks a high-risk recipient until the user explicitly accepts the risk', async () => {
    const user = userEvent.setup()
    renderApp('/pay')
    await startPayment(user, '5000', /flagged account/i)

    expect(screen.getByText(/high risk recipient detected/i)).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: /confirm with pin/i })
    expect(confirm).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /i understand the confirmed fraud reports/i }))
    await waitFor(() => expect(confirm).toBeEnabled())
  }, 30_000)

  it('reverses the earlier steps when a leg fails and tells the user their money is back', async () => {
    demo.forceFailure = true
    const user = userEvent.setup()
    renderApp('/pay')
    await startPayment(user, '145000', /ada n\./i)
    await enterPinAndPay(user)

    expect(await screen.findByText(/payment did not go through/i, {}, { timeout: 30_000 })).toBeInTheDocument()
    expect(screen.getByText(/your money is back/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  }, 60_000)
})
