import { describe, expect, it } from 'vitest'
import type { FeedRow, ReconciliationResponse } from '../api/types'
import { answerHabitQuestion } from './habitAssistant'
import { ledgerToCsv } from './ledgerCsv'
import { computeRunway } from './runway'
import { computeSpending } from './spendingStats'

const NOW = new Date('2026-11-04T12:00:00Z').getTime()
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

const row = (over: Partial<FeedRow>): FeedRow => ({
  bank_name: 'Access Bank',
  amount_kobo: -100_000,
  direction: 'outgoing',
  category: 'Food & Dining',
  verification: 'confirmed',
  counterparty: 'Mama Put Kitchen',
  created_at: daysAgo(1),
  ...over,
})

const FEED: FeedRow[] = [
  row({}),
  row({ amount_kobo: -300_000, category: 'Transport', counterparty: 'Bolt', bank_name: 'GTBank', created_at: daysAgo(3) }),
  row({ amount_kobo: -50_000, category: 'Bills', counterparty: 'IKEDC', created_at: daysAgo(10) }),
  row({ amount_kobo: 2_000_000, direction: 'incoming', category: 'Salary', counterparty: 'Northwind', created_at: daysAgo(2) }),
  row({ amount_kobo: -999_000, created_at: daysAgo(60) }), // outside the 30 day window
]

describe('computeSpending', () => {
  it('totals money in and out for the window and ignores older rows', () => {
    const s = computeSpending(FEED, '30d', 5_000_000, NOW)
    expect(s.totalInflowKobo).toBe(2_000_000)
    expect(s.totalOutflowKobo).toBe(450_000)
    expect(s.incomingCount).toBe(1)
    expect(s.outgoingCount).toBe(3)
    expect(s.netCashflowKobo).toBe(1_550_000)
    expect(s.savingsRate).toBe(78)
  })

  it('includes everything for "all" and narrows for 7 days', () => {
    expect(computeSpending(FEED, 'all', 0, NOW).totalOutflowKobo).toBe(450_000 + 999_000)
    expect(computeSpending(FEED, '7d', 0, NOW).totalOutflowKobo).toBe(400_000)
  })

  it('ranks categories and banks by spend and their shares add up', () => {
    const s = computeSpending(FEED, '30d', 0, NOW)
    expect(s.categoryStats.map((c) => c.category)).toEqual(['Transport', 'Food & Dining', 'Bills'])
    expect(s.categoryStats.reduce((sum, c) => sum + c.percent, 0)).toBeGreaterThanOrEqual(99)
    expect(s.bankComparisonStats[0].bankName).toBe('GTBank')
    expect(s.merchantStats[0].merchant).toBe('Bolt')
  })

  it('spots recurring bills and builds a 14 day series that holds every outgoing payment', () => {
    const s = computeSpending(FEED, '30d', 0, NOW)
    expect(s.recurringCharges.map((r) => r.name)).toContain('IKEDC')
    expect(s.dailySeries.series).toHaveLength(14)
    // The 10 day old bill is inside the 14 day series; nothing is dropped.
    expect(s.dailySeries.series.reduce((sum, d) => sum + d.amountKobo, 0)).toBe(450_000)
  })

  it('is a pure function of its inputs', () => {
    expect(computeSpending(FEED, '30d', 1, NOW)).toEqual(computeSpending(FEED, '30d', 1, NOW))
  })

  it('does not divide by zero on an empty feed', () => {
    const s = computeSpending([], '30d', 0, NOW)
    expect(s.totalOutflowKobo).toBe(0)
    expect(s.runwayDays).toBe(999)
    expect(s.categoryStats).toEqual([])
  })
})

describe('answerHabitQuestion', () => {
  it('answers from the same numbers the charts show', () => {
    const s = computeSpending(FEED, '30d', 5_000_000, NOW)
    expect(answerHabitQuestion('Which bank is draining fastest?', s, 4)).toContain('GTBank')
    expect(answerHabitQuestion('What are my recurring bills?', s, 4)).toContain('IKEDC')
    expect(answerHabitQuestion('whats my highest expense', s, 4)).toContain('Bolt')
    expect(answerHabitQuestion('who did i pay most', s, 4)).toContain('Bolt')
    expect(answerHabitQuestion('something unrelated', s, 4)).toContain('4 linked accounts')
  })
})

describe('computeRunway', () => {
  it('splits the balance into shares that add up to the total', () => {
    const r = computeRunway(32_850_000)
    expect(r.shares.reduce((sum, x) => sum + x.amountKobo, 0)).toBe(32_850_000)
    expect(r.runwayDays).toBeGreaterThan(0)
  })
})

describe('ledgerToCsv', () => {
  it('exports totals and one line per credit', () => {
    const rec: ReconciliationResponse = {
      totals: { credits: 1, credit_kobo: 10_000_000, sent_kobo: 5_000_000, held_kobo: 0, kept_kobo: 5_000_000, fees_kobo: 2_000 },
      credits: [
        {
          run_id: 'r1',
          credit_id: 'c1',
          received_at: '2026-11-04T10:00:00Z',
          amount_kobo: 10_000_000,
          run_state: 'settled',
          entries: [],
          sent_kobo: 5_000_000,
          held_kobo: 0,
          kept_kobo: 5_000_000,
          balanced: true,
        },
      ],
    }
    const csv = ledgerToCsv(rec, new Date('2026-11-04T12:00:00Z'))
    expect(csv).toContain('Total Inflow (NGN),100000.00')
    expect(csv).toContain('Platform Fees (NGN),20.00')
    expect(csv).toContain('r1,c1,2026-11-04T10:00:00Z,100000.00,settled,50000.00,50000.00,0.00,YES')
  })
})
