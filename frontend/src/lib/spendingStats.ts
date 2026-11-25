import type { FeedRow } from '../api/types'

export type TimeRange = '7d' | '30d' | 'all'

export const CATEGORY_COLORS: Record<string, string> = {
  'Food & Dining': '#0f766e', // teal-700
  Transport: '#2563eb', // blue-600
  Bills: '#d97706', // amber-600
  Shopping: '#9333ea', // purple-600
  'Airtime & Data': '#059669', // emerald-600
  Health: '#e11d48', // rose-600
  Transfer: '#475569', // slate-600
  Other: '#64748b', // slate-500
}

export interface CategoryStat {
  category: string
  totalKobo: number
  count: number
  percent: number
  color: string
}

export interface BankFlowStat {
  bankName: string
  inflowKobo: number
  outflowKobo: number
  netKobo: number
  count: number
  maxVal: number
}

export interface MerchantStat {
  merchant: string
  category: string
  totalKobo: number
  count: number
  avgKobo: number
  percent: number
}

export interface RecurringCharge {
  name: string
  count: number
  amountKobo: number
  category: string
}

export interface WeekendSplit {
  weekendPercent: number
  weekdayPercent: number
  weekendKobo: number
  weekdayKobo: number
}

export interface DayBucket {
  label: string
  date: string
  amountKobo: number
  count: number
  isWeekend: boolean
}

export interface ExpenseItem {
  counterparty: string
  category: string
  bankName: string
  amountKobo: number
  date?: string
}

export interface SpendingStats {
  totalInflowKobo: number
  totalOutflowKobo: number
  incomingCount: number
  outgoingCount: number
  netCashflowKobo: number
  savingsRate: number
  dailyBurnKobo: number
  totalBalanceKobo: number
  runwayDays: number
  highestExpense: ExpenseItem | null
  categoryStats: CategoryStat[]
  bankComparisonStats: BankFlowStat[]
  merchantStats: MerchantStat[]
  recurringCharges: RecurringCharge[]
  weekendVsWeekday: WeekendSplit
  dailySeries: { series: DayBucket[]; maxKobo: number }
}

const DAY_MS = 24 * 60 * 60 * 1000
const isIncoming = (r: FeedRow) => r.direction === 'incoming' || r.amount_kobo > 0
const SUBSCRIPTION_HINTS = ['netflix', 'spotify', 'ikedc', 'airtime', 'vtu', 'cowry', 'cloud', 'gym']

/** All the numbers behind the spending charts. `nowMs` is passed in so the result is a pure function of its inputs. */
export function computeSpending(
  feed: FeedRow[],
  timeRange: TimeRange,
  totalBalanceKobo: number,
  nowMs: number,
): SpendingStats {
  // Filter feed based on timeRange
  const filteredFeed =
    timeRange === 'all'
      ? feed
      : feed.filter((r) => {
          if (!r.created_at) return true
          const cutoff = nowMs - (timeRange === '7d' ? 7 : 30) * DAY_MS
          return new Date(r.created_at).getTime() >= cutoff
        })

  // Aggregate outflows and inflows
  let totalInflowKobo = 0
  let totalOutflowKobo = 0
  const outgoingTxns: FeedRow[] = []
  let incomingCount = 0
  for (const r of filteredFeed) {
    if (isIncoming(r)) {
      totalInflowKobo += Math.abs(r.amount_kobo)
      incomingCount += 1
    } else {
      totalOutflowKobo += Math.abs(r.amount_kobo)
      outgoingTxns.push(r)
    }
  }

  const netCashflowKobo = totalInflowKobo - totalOutflowKobo
  const savingsRate = totalInflowKobo > 0 ? Math.round((netCashflowKobo / totalInflowKobo) * 100) : 0
  const dailyBurnKobo = Math.round(totalOutflowKobo / (timeRange === '7d' ? 7 : 30))
  const runwayDays = dailyBurnKobo > 0 ? Math.round(totalBalanceKobo / dailyBurnKobo) : 999

  // Highest single expense
  let highestExpense: ExpenseItem | null = null
  for (const tx of outgoingTxns) {
    const amt = Math.abs(tx.amount_kobo)
    if (!highestExpense || amt > highestExpense.amountKobo) {
      highestExpense = {
        counterparty: tx.counterparty || tx.category || 'Unknown Payee',
        category: tx.category || 'General',
        bankName: tx.bank_name || 'Linked Bank',
        amountKobo: amt,
        date: tx.created_at,
      }
    }
  }

  // Category aggregation
  const categoryMap = new Map<string, { totalKobo: number; count: number }>()
  for (const tx of outgoingTxns) {
    const cat = tx.category || 'Other'
    const cur = categoryMap.get(cat) ?? { totalKobo: 0, count: 0 }
    cur.totalKobo += Math.abs(tx.amount_kobo)
    cur.count += 1
    categoryMap.set(cat, cur)
  }
  const categoryStats: CategoryStat[] = Array.from(categoryMap.entries())
    .map(([category, stats]) => ({
      category,
      totalKobo: stats.totalKobo,
      count: stats.count,
      percent: totalOutflowKobo > 0 ? Math.round((stats.totalKobo / totalOutflowKobo) * 100) : 0,
      color: CATEGORY_COLORS[category] ?? '#64748b',
    }))
    .sort((a, b) => b.totalKobo - a.totalKobo)

  // Bank inflow vs outflow comparison
  const bankMap = new Map<string, { inflowKobo: number; outflowKobo: number; count: number }>()
  for (const r of filteredFeed) {
    const bName = r.bank_name || 'Other'
    const cur = bankMap.get(bName) ?? { inflowKobo: 0, outflowKobo: 0, count: 0 }
    const amt = Math.abs(r.amount_kobo)
    if (isIncoming(r)) cur.inflowKobo += amt
    else cur.outflowKobo += amt
    cur.count += 1
    bankMap.set(bName, cur)
  }
  const bankComparisonStats: BankFlowStat[] = Array.from(bankMap.entries())
    .map(([bankName, stats]) => ({
      bankName,
      inflowKobo: stats.inflowKobo,
      outflowKobo: stats.outflowKobo,
      netKobo: stats.inflowKobo - stats.outflowKobo,
      count: stats.count,
      maxVal: Math.max(stats.inflowKobo, stats.outflowKobo, 1),
    }))
    .sort((a, b) => b.outflowKobo - a.outflowKobo)

  // Merchant leaderboard
  const merchantMap = new Map<string, { totalKobo: number; count: number; category: string }>()
  for (const tx of outgoingTxns) {
    const name = tx.counterparty || tx.category || 'Unknown'
    const cur = merchantMap.get(name) ?? { totalKobo: 0, count: 0, category: tx.category }
    cur.totalKobo += Math.abs(tx.amount_kobo)
    cur.count += 1
    merchantMap.set(name, cur)
  }
  const merchantStats: MerchantStat[] = Array.from(merchantMap.entries())
    .map(([merchant, stats]) => ({
      merchant,
      category: stats.category,
      totalKobo: stats.totalKobo,
      count: stats.count,
      avgKobo: Math.round(stats.totalKobo / stats.count),
      percent: totalOutflowKobo > 0 ? Math.round((stats.totalKobo / totalOutflowKobo) * 100) : 0,
    }))
    .sort((a, b) => b.totalKobo - a.totalKobo)
    .slice(0, 8)

  // Subscriptions and recurring detector
  const recurringMap = new Map<string, { count: number; amountKobo: number; category: string }>()
  for (const tx of outgoingTxns) {
    const name = (tx.counterparty || tx.category).toLowerCase()
    if (SUBSCRIPTION_HINTS.some((hint) => name.includes(hint))) {
      const key = tx.counterparty || tx.category
      const cur = recurringMap.get(key) ?? { count: 0, amountKobo: Math.abs(tx.amount_kobo), category: tx.category }
      cur.count += 1
      recurringMap.set(key, cur)
    }
  }
  const recurringCharges: RecurringCharge[] = Array.from(recurringMap.entries()).map(([name, val]) => ({
    name,
    count: val.count,
    amountKobo: val.amountKobo,
    category: val.category,
  }))

  // Weekend vs weekday
  let weekendKobo = 0
  let weekdayKobo = 0
  for (const tx of outgoingTxns) {
    if (!tx.created_at) continue
    const day = new Date(tx.created_at).getDay()
    const amt = Math.abs(tx.amount_kobo)
    if (day === 0 || day === 6) weekendKobo += amt
    else weekdayKobo += amt
  }
  const weekTotal = weekendKobo + weekdayKobo || 1
  const weekendVsWeekday: WeekendSplit = {
    weekendPercent: Math.round((weekendKobo / weekTotal) * 100),
    weekdayPercent: Math.round((weekdayKobo / weekTotal) * 100),
    weekendKobo,
    weekdayKobo,
  }

  // 14-day daily histogram
  const series: DayBucket[] = []
  const today = new Date(nowMs)
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dayOfWeek = d.getDay()
    series.push({
      label: d.toLocaleDateString('en-NG', { weekday: 'short', month: 'numeric', day: 'numeric' }),
      date: d.toISOString().slice(0, 10),
      amountKobo: 0,
      count: 0,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    })
  }
  for (const tx of outgoingTxns) {
    if (!tx.created_at) continue
    const bucket = series.find((b) => b.date === tx.created_at!.slice(0, 10)) ?? series[series.length - 1]
    bucket.amountKobo += Math.abs(tx.amount_kobo)
    bucket.count += 1
  }
  const dailySeries = { series, maxKobo: Math.max(...series.map((r) => r.amountKobo), 1) }

  return {
    totalInflowKobo,
    totalOutflowKobo,
    incomingCount,
    outgoingCount: outgoingTxns.length,
    netCashflowKobo,
    savingsRate,
    dailyBurnKobo,
    totalBalanceKobo,
    runwayDays,
    highestExpense,
    categoryStats,
    bankComparisonStats,
    merchantStats,
    recurringCharges,
    weekendVsWeekday,
    dailySeries,
  }
}
