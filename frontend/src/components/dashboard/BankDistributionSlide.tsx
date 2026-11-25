import { useState } from 'react'
import type { BankCard } from '../../api/types'
import { BANK_COLORS, DONUT_RADIUS, FALLBACK_BANK_COLORS, buildDonutSegments } from '../../lib/donut'
import { useBalancePrivacy } from '../../context/useBalancePrivacy'
import { formatKobo } from '../../lib/money'
import { cx } from '../ui'

interface Props {
  bankCards: BankCard[]
  totalKobo: number
}

/** Where the money sits: a donut and a legend, one slice per reachable bank. */
export function BankDistributionSlide({ bankCards, totalKobo }: Props) {
  const { hideBalance } = useBalancePrivacy()
  const [hoveredBank, setHoveredBank] = useState<string | null>(null)
  const [selectedBank, setSelectedBank] = useState<string | null>(null)

  const totalBalance = Math.max(1, totalKobo)
  const bankShares = bankCards
    .filter((c) => !c.unavailable && c.balance_kobo > 0)
    .map((c) => ({
      name: c.bank_name,
      amountKobo: c.balance_kobo,
      percent: Math.round((c.balance_kobo / totalBalance) * 100),
    }))
  const bankItems = bankShares.map((b, i) => ({
    ...b,
    color: BANK_COLORS[b.name] ?? FALLBACK_BANK_COLORS[i % FALLBACK_BANK_COLORS.length],
  }))
  const bankDonutSlices = buildDonutSegments(bankItems, DONUT_RADIUS)

  const activeBankSlice =
    hoveredBank || selectedBank ? bankDonutSlices.find((b) => b.name === (hoveredBank || selectedBank)) ?? null : null

  return (
    <div className="w-full shrink-0 px-1">
      <div className="flex flex-col @lg:flex-row items-center gap-8 py-1">
        {/* Circular Pie/Donut Chart */}
        <div className="relative size-44 sm:size-48 shrink-0 flex items-center justify-center">
          <svg className="size-full -rotate-90" viewBox="0 0 160 160">
            <circle
              cx="80"
              cy="80"
              r={DONUT_RADIUS}
              fill="transparent"
              stroke="currentColor"
              strokeWidth="18"
              className="text-slate-100 dark:text-slate-800"
            />
            {bankDonutSlices.map((slice) => {
              const isHovered = hoveredBank === slice.name || selectedBank === slice.name
              return (
                <circle
                  key={slice.name}
                  cx="80"
                  cy="80"
                  r={slice.radius}
                  fill="transparent"
                  stroke={slice.color}
                  strokeWidth={isHovered ? 24 : 18}
                  strokeDasharray={slice.strokeDasharray}
                  strokeDashoffset={slice.strokeDashoffset}
                  className="cursor-pointer transition-all duration-200"
                  onMouseEnter={() => setHoveredBank(slice.name)}
                  onMouseLeave={() => setHoveredBank(null)}
                  onClick={() => setSelectedBank(selectedBank === slice.name ? null : slice.name)}
                >
                  <title>{hideBalance ? `${slice.name}: ${slice.percent}%` : `${slice.name}: ${slice.percent}% (${formatKobo(slice.amountKobo)})`}</title>
                </circle>
              )
            })}
          </svg>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center p-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
              {activeBankSlice?.name ?? 'All Banks'}
            </span>
            <span className="text-base font-bold tabular-nums text-slate-900 dark:text-white">
              {formatKobo(activeBankSlice ? activeBankSlice.amountKobo : totalKobo, hideBalance)}
            </span>
            <span className="text-[11px] font-bold text-teal-700 dark:text-teal-400">
              {activeBankSlice ? `${activeBankSlice.percent}% of total` : `${bankShares.length} Accounts`}
            </span>
          </div>
        </div>

        {/* Bank Legend List */}
        <div className="flex-1 w-full space-y-2">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 text-xs font-bold text-slate-700 dark:text-slate-300">
            <span>Connected Bank</span>
            <span>Balance / Share</span>
          </div>
          <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-2">
            {bankDonutSlices.map((b) => {
              const isHovered = hoveredBank === b.name || selectedBank === b.name
              return (
                <div
                  key={b.name}
                  onMouseEnter={() => setHoveredBank(b.name)}
                  onMouseLeave={() => setHoveredBank(null)}
                  onClick={() => setSelectedBank(selectedBank === b.name ? null : b.name)}
                  className={cx(
                    'flex items-center justify-between gap-2 px-3 py-2 rounded-xl transition-colors cursor-pointer text-xs',
                    isHovered ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                    <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{b.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatKobo(b.amountKobo, hideBalance)}
                    </span>
                    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300">
                      {b.percent}%
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
