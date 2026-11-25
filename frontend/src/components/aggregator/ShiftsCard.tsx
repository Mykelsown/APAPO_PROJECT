import type { Shift } from '../../api/types'
import { formatKobo } from '../../lib/money'
import { Card } from '../ui'
import { cx } from '../ui/cx'

/** Category spending changes against last month, straight from the insights numbers. */
export function ShiftsCard({ shifts }: { shifts: Shift[] }) {
  return (
    <Card className="p-5 space-y-4 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
            Changes Compared to Last Month
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">
            See which areas of your spending increased or decreased
          </p>
        </div>
        <span className="rounded-md bg-teal-50 dark:bg-teal-950 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800 px-2 py-0.5 text-[10px] font-bold">
          Monthly Trends
        </span>
      </div>

      <div className="space-y-3">
        {shifts.length === 0 ? (
          <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">
            Collecting transaction history to show changes compared to last month.
          </p>
        ) : (
          shifts.map((s) => {
            const isSurge = s.percent_change > 0
            return (
              <div
                key={s.category}
                className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-3.5 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-white text-sm">{s.category}</span>
                  <span
                    className={cx(
                      'rounded-full px-2 py-0.5 text-[11px] font-bold border',
                      isSurge
                        ? 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                        : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
                    )}
                  >
                    {isSurge ? `+${s.percent_change}% Increase` : `${s.percent_change}% Decrease`}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600 dark:text-slate-400">
                  <span>
                    This Month: <strong className="text-slate-900 dark:text-white">{formatKobo(s.current_total_kobo)}</strong>
                  </span>
                  <span>
                    Prior Month: <strong className="text-slate-700 dark:text-slate-300">{formatKobo(s.previous_total_kobo)}</strong>
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400 font-medium pt-1 border-t border-slate-200 dark:border-slate-700">
                  <span className="shrink-0">
                    Weekend Share: {s.weekend_share_curr}% (was {s.weekend_share_prev}%)
                  </span>
                  <span className="truncate max-w-[55%] text-right" title={s.top_counterparties.join(', ')}>
                    Payees: {s.top_counterparties.join(', ')}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}
