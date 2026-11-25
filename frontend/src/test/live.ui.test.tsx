// @vitest-environment jsdom
//
// The real screens driving the real Go backend: sign in, open the dashboard, and pay N150,000 across
// three banks with the PIN. Opt-in, and it spends the demo balances, so give it a fresh backend:
//   restart the backend, then:  APAPO_LIVE=1 npx vitest run live.ui
// Run it before (or after a restart from) live.contract, which spends the same balances.
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const LIVE = Boolean(process.env.APAPO_LIVE)
const URL = process.env.APAPO_BACKEND_URL ?? 'http://localhost:8080'
const PHONE = '+2348012345678'
const PIN = '4821'
const SLOW = { timeout: 20_000 }

afterEach(cleanup)

describe.skipIf(!LIVE)('live backend: the demo screens', () => {
  let renderApp: typeof import('./renderApp').renderApp

  beforeAll(async () => {
    vi.stubEnv('VITE_API_MODE', 'real')
    vi.stubEnv('VITE_API_BASE_URL', URL)
    vi.resetModules()
    // Imported only now, so the app picks the real client.
    const { realApi } = await import('../api/real')
    ;({ renderApp } = await import('./renderApp'))

    // Onboard the demo user if the backend is fresh, otherwise just sign in.
    try {
      await realApi.auth.login({ phone: PHONE, pin: PIN })
    } catch {
      await realApi.auth.sendOtp(PHONE)
      await realApi.auth.verifyOtp(PHONE, '123456')
      await realApi.auth.submitBvn('22552255225')
      await realApi.auth.setPin({ pin: PIN, confirm_pin: PIN })
    }
    for (const name of ['Apex Bank', 'Delta Trust Bank', 'Savanna Bank', 'Harbor MFB']) {
      await realApi.banks.link({ bank_name: name, consent: true }).catch(() => undefined)
    }
  })

  it('shows the real balances and banks on the dashboard', async () => {
    renderApp('/')
    expect(await screen.findByText(/total combined balance/i, {}, SLOW)).toBeInTheDocument()
    for (const bank of ['Apex Bank', 'Delta Trust Bank', 'Savanna Bank', 'Harbor MFB']) {
      expect((await screen.findAllByText(bank, {}, SLOW)).length).toBeGreaterThan(0)
    }
  }, 40_000)

  it('pays across three banks with the PIN and shows the receipt', async () => {
    const user = userEvent.setup()
    renderApp('/pay')

    await user.type(await screen.findByLabelText(/transfer amount/i), '150000')
    await screen.findByRole('option', { name: 'Apex Bank' }, SLOW)
    await user.click(screen.getByRole('button', { name: /ada n\./i }))
    await user.click(screen.getByRole('button', { name: /calculate split-pay plan/i }))
    expect(await screen.findByText(/paid from 3 accounts/i, {}, SLOW)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /confirm with pin/i }))
    await user.click(await screen.findByRole('button', { name: /use keyboard/i }))
    await user.type(screen.getByLabelText(/security pin/i), PIN)
    await user.click(screen.getByRole('button', { name: /pay now/i }))

    expect(await screen.findByRole('heading', { name: 'Payment sent' }, { timeout: 30_000 })).toBeInTheDocument()
    expect(screen.getByText(/total charged/i)).toBeInTheDocument()
    // Every leg of the receipt names its bank, which the backend's status does not return itself.
    for (const bank of ['Apex Bank', 'Delta Trust Bank', 'Savanna Bank']) {
      expect(screen.getAllByText(bank).length).toBeGreaterThan(0)
    }
  }, 60_000)

  it('rejects a wrong PIN on the pay screen without moving money', async () => {
    const user = userEvent.setup()
    renderApp('/pay')
    await user.type(await screen.findByLabelText(/transfer amount/i), '1000')
    await screen.findByRole('option', { name: 'Apex Bank' }, SLOW)
    await user.click(screen.getByRole('button', { name: /ada n\./i }))
    await user.click(screen.getByRole('button', { name: /calculate split-pay plan/i }))
    await screen.findByText(/paid from \d accounts?/i, {}, SLOW)
    await user.click(screen.getByRole('button', { name: /confirm with pin/i }))
    await user.click(await screen.findByRole('button', { name: /use keyboard/i }))
    await user.type(screen.getByLabelText(/security pin/i), '0000')
    await user.click(screen.getByRole('button', { name: /pay now/i }))

    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent(/wrong pin/i)
  }, 60_000)
})
