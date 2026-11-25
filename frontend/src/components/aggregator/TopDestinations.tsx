import { formatKobo } from '../../lib/money'
import type { MerchantStat } from '../../lib/spendingStats'
import { Card } from '../ui'

export function TopDestinations({ merchantStats }: { merchantStats: MerchantStat[] }) {
  return (
    <Card className="p-5 space-y-3 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Top Spending Destinations</h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Ranked payees and merchants</p>
        </div>
        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
          {merchantStats.length} destinations
        </span>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800 space-y-1">
        {merchantStats.map((m, idx) => (
          <div key={m.merchant} className="flex items-center justify-between py-2 text-xs">
            <div className="flex items-center gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-700 dark:text-slate-300">
                {idx + 1}
              </span>
              <div>
                <p className="font-bold text-slate-900 dark:text-white">{m.merchant}</p>
                <p className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">
                  {m.category} · {m.count} {m.count === 1 ? 'charge' : 'charges'}
                </p>
              </div>
            </div>

            <div className="text-right">
              <p className="font-bold tabular-nums text-slate-900 dark:text-white">{formatKobo(m.totalKobo)}</p>
              <p className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">avg {formatKobo(m.avgKobo)}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
