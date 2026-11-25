import type { ReactNode } from 'react'
import type { RiskTier } from '../../api/types'
import { cx } from './cx'

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'purple'

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
  green: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800',
  amber: 'bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
  red: 'bg-rose-50 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800',
  blue: 'bg-sky-50 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800',
  purple: 'bg-purple-50 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone])}>
      {children}
    </span>
  )
}

const risk: Record<RiskTier, { tone: Tone; label: string }> = {
  low: { tone: 'green', label: 'Low risk' },
  unknown: { tone: 'amber', label: 'Not enough history' },
  high: { tone: 'red', label: 'High risk' },
}

/** Text label always accompanies the colour so risk is not conveyed by colour alone. */
export function RiskBadge({ tier }: { tier: RiskTier }) {
  return <Badge tone={risk[tier].tone}>{risk[tier].label}</Badge>
}
