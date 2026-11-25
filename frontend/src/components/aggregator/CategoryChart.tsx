import { useMemo, useState } from 'react'
import { formatKobo } from '../../lib/money'
import type { CategoryStat } from '../../lib/spendingStats'
import { cx } from '../ui/cx'

interface Props {
  categoryStats: CategoryStat[]
  totalOutflowKobo: number
}

/** Donut of spend by category plus a legend. Hover and selection are local to this chart. */
export function CategoryChart({ categoryStats, totalOutflowKobo }: Props) {
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  // SVG donut slice geometry
  const donutSlices = useMemo(() => {
    const radius = 64
    const circumference = 2 * Math.PI * radius

    return categoryStats.map((cat, i) => {
      const accumulatedPercent = categoryStats.slice(0, i).reduce((sum, c) => sum + c.percent, 0)
      const strokeDasharray = `${(cat.percent / 100) * circumference} ${circumference}`
      const strokeDashoffset = -((accumulatedPercent / 100) * circumference)
      return { ...cat, radius, circumference, strokeDasharray, strokeDashoffset }
    })
  }, [categoryStats])

  const activeCategoryInfo = useMemo(() => {
    const target = hoveredCategory || selectedCategory || (categoryStats[0]?.category ?? null)
    if (!target) return null
    return categoryStats.find((c) => c.category === target) ?? null
  }, [hoveredCategory, selectedCategory, categoryStats])

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
      {/* Left: SVG Donut Visualization */}
      <div className="md:col-span-5 flex flex-col items-center justify-center">
        <div className="relative size-56 sm:size-64">
          <svg className="size-full -rotate-90 transform" viewBox="0 0 160 160">
            {/* Background Track */}
            <circle
              cx="80"
              cy="80"
              r="64"
              fill="transparent"
              stroke="currentColor"
              strokeWidth="20"
              className="text-slate-100 dark:text-slate-800"
            />
            {/* Segments */}
            {donutSlices.map((slice) => {
              const isHovered = hoveredCategory === slice.category || selectedCategory === slice.category
              return (
                <circle
                  key={slice.category}
                  cx="80"
                  cy="80"
                  r={slice.radius}
                  fill="transparent"
                  stroke={slice.color}
                  strokeWidth={isHovered ? 26 : 20}
                  strokeDasharray={slice.strokeDasharray}
                  strokeDashoffset={slice.strokeDashoffset}
                  className="cursor-pointer transition-all duration-200"
                  onMouseEnter={() => setHoveredCategory(slice.category)}
                  onMouseLeave={() => setHoveredCategory(null)}
                  onClick={() => setSelectedCategory(selectedCategory === slice.category ? null : slice.category)}
                />
              )
            })}
          </svg>

          {/* Donut Center Display */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center p-4">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate max-w-[140px]">
              {activeCategoryInfo?.category ?? 'Total Spent'}
            </span>
            <span className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white">
              {formatKobo(activeCategoryInfo ? activeCategoryInfo.totalKobo : totalOutflowKobo)}
            </span>
            <span className="text-[11px] font-semibold text-teal-700 dark:text-teal-400">
              {activeCategoryInfo ? `${activeCategoryInfo.percent}% of spend` : `${categoryStats.length} Categories`}
            </span>
          </div>
        </div>
        <p className="mt-3 text-[11px] font-medium text-slate-500 dark:text-slate-400 text-center">
          Tap or hover on any color slice to see amount
        </p>
      </div>

      {/* Right: Category Legend & Volume Bars */}
      <div className="md:col-span-7 space-y-3">
        <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2">
          <span>Categories</span>
          <span>Amount / Share</span>
        </div>

        <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
          {categoryStats.map((cat) => {
            const isHovered = hoveredCategory === cat.category || selectedCategory === cat.category
            return (
              <div
                key={cat.category}
                onMouseEnter={() => setHoveredCategory(cat.category)}
                onMouseLeave={() => setHoveredCategory(null)}
                onClick={() => setSelectedCategory(selectedCategory === cat.category ? null : cat.category)}
                className={cx(
                  'p-2.5 rounded-xl cursor-pointer transition-all border',
                  isHovered
                    ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 ring-1 ring-teal-600'
                    : 'border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="font-bold text-slate-900 dark:text-white">{cat.category}</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                      ({cat.count} payments)
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatKobo(cat.totalKobo)}
                    </span>
                    <span className="ml-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      ({cat.percent}%)
                    </span>
                  </div>
                </div>

                <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    style={{ width: `${cat.percent}%`, backgroundColor: cat.color }}
                    className="h-full rounded-full transition-all duration-300"
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
