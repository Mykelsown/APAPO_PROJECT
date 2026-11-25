import { useState } from 'react'
import { DONUT_RADIUS, buildDonutSegments } from '../../lib/donut'
import { useBalancePrivacy } from '../../context/useBalancePrivacy'
import { formatKobo } from '../../lib/money'
import type { computeRunway } from '../../lib/runway'
import { cx } from '../ui'

type Runway = ReturnType<typeof computeRunway>

/** How long the balance lasts, split into essentials, daily spending and savings. */
export function RunwaySlide({ runway }: { runway: Runway }) {
  const { hideBalance } = useBalancePrivacy()
  const [hoveredRunway, setHoveredRunway] = useState<string | null>(null)
  const [selectedRunway, setSelectedRunway] = useState<string | null>(null)

  const runwaySegments = buildDonutSegments(runway.shares, DONUT_RADIUS)
  const activeRunwaySegment =
    hoveredRunway || selectedRunway ? runwaySegments.find((s) => s.id === (hoveredRunway || selectedRunway)) ?? null : null

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
            {runwaySegments.map((slice) => {
              const isHovered = hoveredRunway === slice.id || selectedRunway === slice.id
              return (
                <circle
                  key={slice.id}
                  cx="80"
                  cy="80"
                  r={slice.radius}
                  fill="transparent"
                  stroke={slice.color}
                  strokeWidth={isHovered ? 24 : 18}
                  strokeDasharray={slice.strokeDasharray}
                  strokeDashoffset={slice.strokeDashoffset}
                  className="cursor-pointer transition-all duration-200"
                  onMouseEnter={() => setHoveredRunway(slice.id)}
                  onMouseLeave={() => setHoveredRunway(null)}
                  onClick={() => setSelectedRunway(selectedRunway === slice.id ? null : slice.id)}
                >
                  <title>{hideBalance ? `${slice.name}: ${slice.percent}%` : `${slice.name}: ${slice.percent}% (${formatKobo(slice.amountKobo)})`}</title>
                </circle>
              )
            })}
          </svg>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center p-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
              {activeRunwaySegment?.name ?? 'Runway'}
            </span>
            <span className="text-base font-bold tabular-nums text-slate-900 dark:text-white">
              {activeRunwaySegment ? formatKobo(activeRunwaySegment.amountKobo, hideBalance) : `${runway.runwayDays} Days`}
            </span>
            <span className="text-[11px] font-bold text-teal-700 dark:text-teal-400">
              {activeRunwaySegment ? `${activeRunwaySegment.percent}% share` : 'Safe Buffer'}
            </span>
          </div>
        </div>

        {/* Runway Legend List & Daily Burn */}
        <div className="flex-1 w-full space-y-2">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 text-xs font-bold text-slate-700 dark:text-slate-300">
            <span>Allocation Category</span>
            <span>Amount / Share</span>
          </div>
          <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-2">
            {runwaySegments.map((seg) => {
              const isHovered = hoveredRunway === seg.id || selectedRunway === seg.id
              return (
                <div
                  key={seg.id}
                  onMouseEnter={() => setHoveredRunway(seg.id)}
                  onMouseLeave={() => setHoveredRunway(null)}
                  onClick={() => setSelectedRunway(selectedRunway === seg.id ? null : seg.id)}
                  className={cx(
                    'flex items-center justify-between gap-2 px-3 py-2 rounded-xl transition-colors cursor-pointer text-xs',
                    isHovered ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                    <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{seg.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatKobo(seg.amountKobo, hideBalance)}
                    </span>
                    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300">
                      {seg.percent}%
                    </span>
                  </div>
                </div>
              )
            })}

            <div className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs">
              <span className="text-slate-600 dark:text-slate-400 font-medium">Average Spend</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">~{hideBalance ? '₦ ••••' : formatKobo(runway.dailyBurnKobo)}/day</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
