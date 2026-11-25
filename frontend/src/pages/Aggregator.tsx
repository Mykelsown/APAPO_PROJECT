import { useMemo, useState } from 'react'
import { api } from '../api/client'
import { AggregatorHeader } from '../components/aggregator/AggregatorHeader'
import { ChartsCard } from '../components/aggregator/ChartsCard'
import { HabitsAssistant } from '../components/aggregator/HabitsAssistant'
import { HabitsCard } from '../components/aggregator/HabitsCard'
import { KpiCards } from '../components/aggregator/KpiCards'
import { ShiftsCard } from '../components/aggregator/ShiftsCard'
import { TopDestinations } from '../components/aggregator/TopDestinations'
import { useToast } from '../components/ui'
import { answerHabitQuestion } from '../lib/habitAssistant'
import { formatKobo } from '../lib/money'
import { computeSpending, type TimeRange } from '../lib/spendingStats'
import { useAsync } from '../lib/useAsync'

function AggregatorSkeleton() {
  return (
    <div className="space-y-6 pt-2" aria-busy="true">
      <div className="h-20 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
      <div className="h-64 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
    </div>
  )
}

export function Aggregator() {
  const toast = useToast()
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')
  // Taken once on mount so the 7 and 30 day windows stay stable while the page is open.
  const [nowMs] = useState(() => Date.now())

  // A failed load shows empty charts rather than an error screen, as before.
  const { data, loading } = useAsync(async () => {
    const [dash, accts, shifts] = await Promise.all([
      api.dashboard.get(),
      api.accounts.list(),
      api.insights.shifts().catch(() => ({ shifts: [] })),
    ])
    return { dash, accountCount: accts.accounts.length, shifts: shifts.shifts }
  })

  const feed = data?.dash.transaction_feed
  const totalBalanceKobo = data?.dash.total_balance_kobo ?? 0
  const stats = useMemo(
    () => computeSpending(feed ?? [], timeRange, totalBalanceKobo, nowMs),
    [feed, timeRange, totalBalanceKobo, nowMs],
  )

  function handleExportStatementCSV() {
    if (!feed || feed.length === 0) {
      toast.show('No transaction records available to export.', 'info')
      return
    }

    const headers = ['ID', 'Date', 'Bank', 'Counterparty', 'Direction', 'Category', 'Amount Kobo', 'Amount NGN', 'Status']
    const lines = feed.map((r) => [
      `"${r.id}"`,
      `"${r.created_at ?? ''}"`,
      `"${r.bank_name}"`,
      `"${r.counterparty ?? ''}"`,
      `"${r.direction}"`,
      `"${r.category}"`,
      r.amount_kobo,
      `"${formatKobo(r.amount_kobo)}"`,
      `"${r.verification ?? 'verified'}"`,
    ].join(','))

    const csvContent = [headers.join(','), ...lines].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `apapo-consolidated-statement-${timeRange}-${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.show(`Consolidated statement exported (${feed.length} transactions).`, 'success')
  }

  if (loading && !data) return <AggregatorSkeleton />

  return (
    <div className="space-y-8 pt-1">
      <AggregatorHeader timeRange={timeRange} onChange={setTimeRange} onExportCSV={handleExportStatementCSV} />
      <KpiCards stats={stats} />
      <ChartsCard stats={stats} />

      {/* Habits and analytics beside the chat assistant */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:items-start">
        <div className="space-y-6 lg:col-span-7">
          <ShiftsCard shifts={data?.shifts ?? []} />
          <TopDestinations merchantStats={stats.merchantStats} />
          <HabitsCard recurringCharges={stats.recurringCharges} weekendVsWeekday={stats.weekendVsWeekday} />
        </div>
        <div className="space-y-6 lg:col-span-5">
          <HabitsAssistant answer={(q) => answerHabitQuestion(q, stats, data?.accountCount ?? 0)} />
        </div>
      </div>
    </div>
  )
}
