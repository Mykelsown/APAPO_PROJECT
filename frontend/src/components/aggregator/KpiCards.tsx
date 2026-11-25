import { useBalancePrivacy } from '../../context/useBalancePrivacy'
import { formatKobo } from '../../lib/money'
import type { SpendingStats } from '../../lib/spendingStats'
import { Card } from '../ui'
import { cx } from '../ui/cx'

export function KpiCards({ stats }: { stats: SpendingStats }) {
  const { hideBalance } = useBalancePrivacy()
  const {
    totalInflowKobo,
    totalOutflowKobo,
    incomingCount,
    outgoingCount,
    netCashflowKobo,
    savingsRate,
    runwayDays,
    dailyBurnKobo,
    totalBalanceKobo,
  } = stats

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
      {/* Total Inflow */}
      <Card className="p-4 space-y-1.5 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Money In</span>
          <span className="flex size-2 rounded-full bg-emerald-500" />
        </div>
        <p className="text-lg sm:text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
          +{formatKobo(totalInflowKobo, hideBalance)}
        </p>
        <p className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">{incomingCount} deposits received</p>
      </Card>

      {/* Total Outflow */}
      <Card className="p-4 space-y-1.5 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Money Out</span>
          <span className="flex size-2 rounded-full bg-red-500" />
        </div>
        <p className="text-lg sm:text-xl font-bold tabular-nums text-slate-900 dark:text-white">
          -{formatKobo(totalOutflowKobo, hideBalance)}
        </p>
        <p className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">{outgoingCount} payments made</p>
      </Card>

      {/* Net Flow & Retention */}
      <Card className="p-4 space-y-1.5 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Money Saved</span>
          <span className="rounded-md bg-teal-50 dark:bg-teal-950 border border-teal-200 dark:border-teal-800 px-1.5 py-0.5 text-[9px] font-bold text-teal-800 dark:text-teal-300">
            {savingsRate}% saved
          </span>
        </div>
        <p
          className={cx(
            'text-lg sm:text-xl font-bold tabular-nums',
            netCashflowKobo >= 0 ? 'text-teal-700 dark:text-teal-400' : 'text-red-600 dark:text-red-400',
          )}
        >
          {netCashflowKobo >= 0 ? '+' : ''}
          {formatKobo(netCashflowKobo, hideBalance)}
        </p>
        <p className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">Left over after spending</p>
      </Card>

      {/* Daily Velocity & Runway */}
      <Card className="p-4 space-y-1.5 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Daily Spending</span>
          <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">{runwayDays} days left</span>
        </div>
        <p className="text-lg sm:text-xl font-bold tabular-nums text-slate-900 dark:text-white">
          {formatKobo(dailyBurnKobo, hideBalance)}
          <span className="text-xs font-semibold text-slate-500">/day</span>
        </p>
        <p className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">
          Total across banks: {formatKobo(totalBalanceKobo, hideBalance)}
        </p>
      </Card>
    </div>
  )
}
