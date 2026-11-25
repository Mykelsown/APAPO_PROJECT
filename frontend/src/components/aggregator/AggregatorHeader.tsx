import { cx } from '../ui/cx'
import type { TimeRange } from '../../lib/spendingStats'

interface Props {
  timeRange: TimeRange
  onChange: (range: TimeRange) => void
  onExportCSV?: () => void
}

export function AggregatorHeader({ timeRange, onChange, onExportCSV }: Props) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
      <div>
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/60 text-teal-700 dark:text-teal-400">
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Spending & Liquidity Analytics
          </h1>
        </div>
        <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium">
          Multi-bank outflow distribution and liquidity burn rate
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {onExportCSV && (
          <button
            type="button"
            onClick={onExportCSV}
            title="Download unified bank statement as CSV"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <svg className="size-3.5 text-teal-600 dark:text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <span>Export Statement</span>
          </button>
        )}

        {/* Time Horizon Pills */}
        <div className="flex items-center rounded-xl bg-slate-200 dark:bg-slate-800 p-1 text-xs font-bold self-start sm:self-auto">
          {(['7d', '30d', 'all'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onChange(r)}
              className={cx(
                'rounded-lg px-3 py-1.5 transition-colors cursor-pointer',
                timeRange === r
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white',
              )}
            >
              {r === '7d' ? 'Last 7 Days' : r === '30d' ? 'Last 30 Days' : 'All Time'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
