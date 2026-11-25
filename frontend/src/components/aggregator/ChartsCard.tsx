import { useState } from 'react'
import type { SpendingStats } from '../../lib/spendingStats'
import { Card } from '../ui'
import { cx } from '../ui/cx'
import { BankFlowChart } from './BankFlowChart'
import { CategoryChart } from './CategoryChart'
import { DailyTimeline } from './DailyTimeline'

type ChartTab = 'category' | 'timeline' | 'banks'

const TABS: { id: ChartTab; label: string }[] = [
  { id: 'category', label: 'By Category' },
  { id: 'timeline', label: 'Daily Spending' },
  { id: 'banks', label: 'Money In vs Out by Bank' },
]

export function ChartsCard({ stats }: { stats: SpendingStats }) {
  const [activeChartTab, setActiveChartTab] = useState<ChartTab>('category')

  return (
    <Card className="p-5 sm:p-6 space-y-6 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
      {/* Chart View Switcher */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Visual Spending Charts</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">
            Interactive visual charts showing where your money goes and your daily habits
          </p>
        </div>

        <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-bold gap-1 self-start sm:self-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveChartTab(tab.id)}
              className={cx(
                'rounded-lg px-3 py-1.5 transition-colors',
                activeChartTab === tab.id
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeChartTab === 'category' && (
        <CategoryChart categoryStats={stats.categoryStats} totalOutflowKobo={stats.totalOutflowKobo} />
      )}
      {activeChartTab === 'timeline' && (
        <DailyTimeline dailySeries={stats.dailySeries} dailyBurnKobo={stats.dailyBurnKobo} />
      )}
      {activeChartTab === 'banks' && (
        <BankFlowChart
          bankComparisonStats={stats.bankComparisonStats}
          totalInflowKobo={stats.totalInflowKobo}
          totalOutflowKobo={stats.totalOutflowKobo}
        />
      )}
    </Card>
  )
}
