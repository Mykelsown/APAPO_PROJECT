// @vitest-environment jsdom
//
// Runtime checks for the big screens that were split into components: the pieces still render,
// switch tabs, filter, and talk to each other the way the single-file versions did.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { session } from '../api/session'
import { renderApp, SLOW } from './renderApp'

beforeEach(() => {
  session.set('mock-token')
})
afterEach(cleanup)

describe('Dashboard', () => {
  it('filters the activity feed by bank and by search, and flips the breakdown chart', async () => {
    const user = userEvent.setup()
    renderApp('/')
    expect(await screen.findByText(/live transaction activity/i, {}, SLOW)).toBeInTheDocument()
    const entries = () => Number(/^(\d+) entries$/.exec(screen.getByText(/^\d+ entries$/).textContent ?? '')?.[1])
    const total = entries()
    expect(total).toBeGreaterThan(5)

    const filter = screen.getByRole('group', { name: /filter by bank/i })
    await user.click(within(filter).getByRole('button', { name: 'GTBank' }))
    const gtb = entries()
    expect(gtb).toBeGreaterThan(0)
    expect(gtb).toBeLessThan(total)
    await user.click(within(filter).getByRole('button', { name: /all banks/i }))
    expect(entries()).toBe(total)

    await user.type(screen.getByLabelText(/search transactions/i), 'bolt')
    expect(entries()).toBe(1)
    await user.type(screen.getByLabelText(/search transactions/i), 'zzz')
    expect(screen.getByText(/nothing matches your search filter/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'How Long Your Money Lasts' }))
    expect(screen.getAllByText(/days safe/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/average spend/i)).toBeInTheDocument()
  }, 40_000)

  it('can hide and show the combined balance', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await screen.findByText(/total combined balance/i, {}, SLOW)
    await user.click(screen.getByRole('button', { name: /hide balance/i }))
    expect(screen.getAllByText(/₦ ••••••••/).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /show balance/i }))
    expect(screen.queryByText(/₦ ••••••••/)).not.toBeInTheDocument()
  }, 30_000)
})

describe('Aggregator (spending charts)', () => {
  it('shows the totals, switches chart tabs and time range, and answers a question', async () => {
    const user = userEvent.setup()
    renderApp('/aggregator')
    expect(await screen.findByText(/visual spending charts/i, {}, SLOW)).toBeInTheDocument()
    expect(screen.getByText('Money In')).toBeInTheDocument()
    expect(screen.getByText('Money Out')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Daily Spending' }))
    expect(screen.getByText(/daily spending \(last 14 days\)/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /money in vs out by bank/i }))
    expect(screen.getByText(/inflow vs outflow by connected bank account/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /by category/i }))
    expect(screen.getByText(/tap or hover on any color slice/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /last 7 days/i }))
    expect(screen.getByRole('button', { name: /last 7 days/i }).className).toContain('bg-teal-700')

    await user.type(screen.getByPlaceholderText(/ask about spending habits/i), 'what are my recurring bills')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/recurring commitments/i, {}, SLOW)).toBeInTheDocument()
  }, 40_000)
})

describe('Split-Receive', () => {
  it('moves between rules, runs and the settlement ledger', async () => {
    const user = userEvent.setup()
    renderApp('/receive')
    expect(await screen.findByText(/1\. receiving account/i, {}, SLOW)).toBeInTheDocument()
    expect(screen.getByText(/interactive rule simulator/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^runs \(/i }))
    expect(screen.getAllByText(/received/i).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Ledger' }))
    expect(screen.getByText(/settlement summary/i)).toBeInTheDocument()
    expect(screen.getByText(/formula invariant/i)).toBeInTheDocument()
  }, 40_000)

  it('keeps unsaved rule edits when switching tabs, and a confirmed demo deposit adds a run', async () => {
    const user = userEvent.setup()
    renderApp('/receive')
    await screen.findByText(/1\. receiving account/i, {}, SLOW)

    const before = Number(/\((\d+)\)/.exec(screen.getByRole('button', { name: /^runs \(/i }).textContent ?? '')?.[1])
    const targets = screen.getAllByText(/^target #/i).length
    await user.click(screen.getByRole('button', { name: /\+ add target/i }))
    expect(screen.getAllByText(/^target #/i)).toHaveLength(targets + 1)

    await user.click(screen.getByRole('button', { name: 'Ledger' }))
    await user.click(screen.getByRole('button', { name: 'Rules' }))
    expect(screen.getAllByText(/^target #/i)).toHaveLength(targets + 1)

    await user.click(screen.getByRole('button', { name: /\+ ₦100,000 confirmed deposit/i }))
    await waitFor(
      () => {
        const after = Number(/\((\d+)\)/.exec(screen.getByRole('button', { name: /^runs \(/i }).textContent ?? '')?.[1])
        expect(after).toBe(before + 1)
      },
      SLOW,
    )
  }, 40_000)
})
