import { formatKobo } from '../../lib/money'
import type { RecurringCharge, WeekendSplit } from '../../lib/spendingStats'
import { Card } from '../ui'

interface Props {
  recurringCharges: RecurringCharge[]
  weekendVsWeekday: WeekendSplit
}

/** Recurring bills and the weekend versus weekday split. */
export function HabitsCard({ recurringCharges, weekendVsWeekday }: Props) {
  return (
    <Card className="p-5 space-y-4 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Spending Habits & Subscriptions</h3>
        <span className="rounded-full bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:text-amber-300">
          Habits
        </span>
      </div>

      {/* Recurring subscriptions pill list */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
          Your Recurring Bills & Subscriptions ({recurringCharges.length})
        </p>
        <div className="grid grid-cols-2 gap-2">
          {recurringCharges.map((r) => (
            <div
              key={r.name}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs space-y-0.5"
            >
              <p className="font-bold text-slate-900 dark:text-white truncate">{r.name}</p>
              <p className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 tabular-nums">
                {formatKobo(r.amountKobo)}
              </p>
              <p className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">Monthly recurring</p>
            </div>
          ))}
        </div>
      </div>

      {/* Weekend vs Weekday metric */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-3 space-y-2 text-xs">
        <div className="flex justify-between items-center font-bold text-slate-900 dark:text-white">
          <span>Weekend vs Weekday Spending</span>
          <span className="text-teal-700 dark:text-teal-400">{weekendVsWeekday.weekendPercent}% Weekend</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            style={{ width: `${weekendVsWeekday.weekdayPercent}%` }}
            className="bg-teal-600 transition-all duration-300"
            title={`Weekday: ${weekendVsWeekday.weekdayPercent}%`}
          />
          <div
            style={{ width: `${weekendVsWeekday.weekendPercent}%` }}
            className="bg-amber-500 transition-all duration-300"
            title={`Weekend: ${weekendVsWeekday.weekendPercent}%`}
          />
        </div>
        <div className="flex justify-between text-[10px] font-semibold text-slate-600 dark:text-slate-400">
          <span>
            Weekday: {formatKobo(weekendVsWeekday.weekdayKobo)} ({weekendVsWeekday.weekdayPercent}%)
          </span>
          <span>
            Weekend: {formatKobo(weekendVsWeekday.weekendKobo)} ({weekendVsWeekday.weekendPercent}%)
          </span>
        </div>
      </div>
    </Card>
  )
}
