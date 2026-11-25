import { formatKobo } from '../../lib/money'
import type { SpendingStats } from '../../lib/spendingStats'
import { cx } from '../ui/cx'

interface Props {
  dailySeries: SpendingStats['dailySeries']
  dailyBurnKobo: number
}

/** Last 14 days of spending as a bar histogram, weekends in amber. */
export function DailyTimeline({ dailySeries, dailyBurnKobo }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-slate-800 dark:text-slate-200">Daily Spending (Last 14 Days)</span>
        <div className="flex items-center gap-3 text-[11px] font-semibold">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-teal-700" /> Weekday
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-amber-500" /> Weekend
          </span>
        </div>
      </div>

      {/* Histogram Bars */}
      <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-4 pt-8">
        <div className="flex h-44 items-end gap-2 sm:gap-3.5 pb-2">
          {dailySeries.series.map((item, idx) => {
            const heightPercent = Math.max(8, Math.round((item.amountKobo / dailySeries.maxKobo) * 100))
            const hasSpend = item.amountKobo > 0
            return (
              <div key={idx} className="group relative flex flex-1 flex-col items-center h-full justify-end">
                {/* Floating Tooltip */}
                <div className="pointer-events-none absolute -top-12 z-20 hidden whitespace-nowrap rounded-lg bg-slate-900 text-white dark:bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold group-hover:block border border-slate-700">
                  <p>
                    {item.label} {item.isWeekend ? '(Weekend)' : ''}
                  </p>
                  <p className="text-teal-400 font-extrabold">{formatKobo(item.amountKobo)}</p>
                </div>

                <div
                  style={{ height: `${heightPercent}%` }}
                  className={cx(
                    'w-full rounded-t-lg transition-all duration-300',
                    hasSpend
                      ? item.isWeekend
                        ? 'bg-amber-500 hover:bg-amber-600'
                        : 'bg-teal-700 hover:bg-teal-600'
                      : 'bg-slate-200 dark:bg-slate-700',
                  )}
                />
              </div>
            )
          })}
        </div>

        {/* Day Labels */}
        <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2 text-[10px] font-bold text-slate-600 dark:text-slate-400">
          <span>{dailySeries.series[0]?.label}</span>
          <span>{dailySeries.series[Math.floor(dailySeries.series.length / 2)]?.label}</span>
          <span>Today</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs text-slate-600 dark:text-slate-400 font-medium gap-2 pt-1">
        <span>
          Peak Day Outflow: <strong className="text-slate-900 dark:text-white">{formatKobo(dailySeries.maxKobo)}</strong>
        </span>
        <span>
          Average Daily Velocity: <strong className="text-slate-900 dark:text-white">{formatKobo(dailyBurnKobo)}</strong> / day
        </span>
      </div>
    </div>
  )
}
