import { formatKobo } from '../../lib/money'
import type { BankFlowStat } from '../../lib/spendingStats'
import { cx } from '../ui/cx'

const BANK_ACCENTS: Record<string, { bg: string; bar: string }> = {
  'Access Bank': { bg: 'bg-[#003865]', bar: '#F37023' },
  GTBank: { bg: 'bg-[#E05A10]', bar: '#E05A10' },
  'Zenith Bank': { bg: 'bg-[#D2232A]', bar: '#D2232A' },
  UBA: { bg: 'bg-[#BA0C12]', bar: '#BA0C12' },
  'Kuda Bank': { bg: 'bg-[#40196D]', bar: '#40196D' },
  'First Bank': { bg: 'bg-[#002B49]', bar: '#002B49' },
}

interface Props {
  bankComparisonStats: BankFlowStat[]
  totalInflowKobo: number
  totalOutflowKobo: number
}

/** Paired inflow and outflow bars for each connected bank. */
export function BankFlowChart({ bankComparisonStats, totalInflowKobo, totalOutflowKobo }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-slate-800 dark:text-slate-200">Inflow vs Outflow by Connected Bank Account</span>
        <div className="flex items-center gap-3 text-[11px] font-semibold">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-emerald-600" /> Inflow (Credits)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-red-600" /> Outflow (Debits)
          </span>
        </div>
      </div>

      {/* Paired Bar Comparison per Bank */}
      <div className="space-y-3">
        {bankComparisonStats.map((b) => {
          const styling = BANK_ACCENTS[b.bankName] ?? { bg: 'bg-slate-800', bar: '#0f766e' }
          const inflowPct = Math.min(100, Math.round((b.inflowKobo / Math.max(totalInflowKobo, 1)) * 100))
          const outflowPct = Math.min(100, Math.round((b.outflowKobo / Math.max(totalOutflowKobo, 1)) * 100))

          return (
            <div
              key={b.bankName}
              className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-3.5 space-y-2.5"
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ backgroundColor: styling.bar }} />
                  <span className="font-bold text-slate-900 dark:text-white text-sm">{b.bankName}</span>
                </div>
                <span
                  className={cx(
                    'text-xs font-bold tabular-nums',
                    b.netKobo >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                  )}
                >
                  Net: {b.netKobo >= 0 ? '+' : ''}
                  {formatKobo(b.netKobo)}
                </span>
              </div>

              {/* Inflow Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="font-medium text-slate-600 dark:text-slate-400">Deposits (Inflow):</span>
                  <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                    +{formatKobo(b.inflowKobo)}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    style={{ width: `${Math.max(b.inflowKobo > 0 ? 5 : 0, inflowPct)}%` }}
                    className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                  />
                </div>
              </div>

              {/* Outflow Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="font-medium text-slate-600 dark:text-slate-400">Spending (Outflow):</span>
                  <span className="font-bold tabular-nums text-red-600 dark:text-red-400">
                    -{formatKobo(b.outflowKobo)}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    style={{ width: `${Math.max(b.outflowKobo > 0 ? 5 : 0, outflowPct)}%` }}
                    className="h-full rounded-full bg-red-600 transition-all duration-300"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
