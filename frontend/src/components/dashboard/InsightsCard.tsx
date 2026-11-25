import { useState } from 'react'
import { api } from '../../api/client'
import type { FeedRow, Shift } from '../../api/types'
import { useBalancePrivacy } from '../../context/useBalancePrivacy'
import { formatKobo } from '../../lib/money'
import { useAsync } from '../../lib/useAsync'
import { Badge, Button, Card } from '../ui'

export function InsightsCard({ feed = [] }: { feed?: FeedRow[] }) {
  const { hideBalance } = useBalancePrivacy()
  const [dismissed, setDismissed] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)

  const { data, loading, error } = useAsync(async () => {
    const res = await api.insights.shifts()
    return res.shifts
  })

  if (dismissed || loading || error || !data || data.length === 0) {
    return null
  }

  // Top shift
  const shift: Shift = data[0]
  const isIncrease = shift.percent_change > 0

  // Narrative text
  const explanation = `${shift.category} spending is ${isIncrease ? 'up' : 'down'} ${Math.abs(
    shift.percent_change,
  )}% this month (${formatKobo(shift.current_total_kobo, hideBalance)} vs ${formatKobo(
    shift.previous_total_kobo,
    hideBalance,
  )} last month), primarily from ${shift.top_counterparties.join('and')}.`

  // Supporting transactions
  const supportingTxns = feed.filter((f) => f.id && shift.supporting_transaction_ids.includes(f.id))

  return (
    <div id="insights-slot">
      <Card className="relative overflow-hidden space-y-4 border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 p-5 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/60 text-teal-700 dark:text-teal-400">
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
              </svg>
            </span>
            <div>
              <span className="text-xs font-semibold text-slate-900 dark:text-white block">Why Did My Money Move?</span>
              <span className="text-[11px] text-teal-700 dark:text-teal-400 font-medium">Outflow Shift Analysis</span>
            </div>
          </div>
          <Badge tone={isIncrease ? 'red' : 'green'}>
            {isIncrease ? `+${shift.percent_change}%` : `${shift.percent_change}%`}
          </Badge>
        </div>

        <p className="text-sm font-medium leading-relaxed text-slate-800 dark:text-slate-200">{explanation}</p>

        {/* Visual comparison meters */}
        <div className="space-y-2 rounded-xl bg-slate-50 dark:bg-slate-800 p-3 ring-1 ring-slate-200 dark:ring-slate-700 text-xs">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="font-semibold text-slate-700 dark:text-slate-300">This Month: {shift.category}</span>
              <span className="font-bold tabular-nums text-slate-900 dark:text-white">{formatKobo(shift.current_total_kobo, hideBalance)} ({shift.transaction_count_curr} txns)</span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-teal-600 transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.round((shift.current_total_kobo / Math.max(shift.current_total_kobo, shift.previous_total_kobo)) * 100))}%`,
                }}
              />
            </div>
          </div>

          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-600 dark:text-slate-400 font-medium">Last Month:</span>
              <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-300">{formatKobo(shift.previous_total_kobo, hideBalance)} ({shift.transaction_count_prev} txns)</span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-slate-400 dark:bg-slate-600 transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.round((shift.previous_total_kobo / Math.max(shift.current_total_kobo, shift.previous_total_kobo)) * 100))}%`,
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setShowDrawer(true)}
            className="inline-flex items-center gap-1 rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/60 px-3 py-1.5 text-xs font-bold text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 transition-colors cursor-pointer"
          >
            <span>Inspect transactions ({supportingTxns.length || shift.supporting_transaction_ids.length})</span>
            <span>→</span>
          </button>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </Card>

      {/* SUPPORTING TRANSACTIONS MODAL */}
      {showDrawer && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900 p-4 sm:items-center"
        >
          <div className="max-h-[85vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Supporting Transactions</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Grounded evidence for {shift.category} shift</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDrawer(false)}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Close
              </button>
            </div>

            <div className="space-y-2">
              {supportingTxns.length === 0 ? (
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 p-4 text-center text-xs text-slate-600 dark:text-slate-400 font-medium">
                  <p>Supporting Transaction IDs:</p>
                  <p className="mt-1 font-mono">{shift.supporting_transaction_ids.join(',')}</p>
                </div>
              ) : (
                supportingTxns.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs"
                  >
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">{tx.counterparty || tx.category}</p>
                      <p className="text-slate-600 dark:text-slate-400 font-medium">{tx.bank_name}</p>
                    </div>
                    <p className="font-bold tabular-nums text-slate-900 dark:text-white">{formatKobo(tx.amount_kobo, hideBalance)}</p>
                  </div>
                ))
              )}
            </div>

            <Button onClick={() => setShowDrawer(false)} block>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
