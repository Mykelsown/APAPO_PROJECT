import type { ReactNode } from 'react'
import type { FeedRow } from '../../api/types'
import { useBalancePrivacy } from '../../context/useBalancePrivacy'
import { formatKobo } from '../../lib/money'
import { timeAgo } from '../../lib/time'
import { Badge, cx } from '../ui'

interface Props {
  row: FeedRow
  onOpenShield?: (row: FeedRow) => void
  onEditCategory?: (row: FeedRow) => void
  onSelectRow?: (row: FeedRow) => void
}

function getCategoryTone(category: string): 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'purple' {
  const norm = category.toLowerCase()
  if (norm.includes('salary') || norm.includes('income')) return 'green'
  if (norm.includes('food') || norm.includes('dining')) return 'amber'
  if (norm.includes('transport')) return 'purple'
  if (norm.includes('bill')) return 'blue'
  if (norm.includes('shopping')) return 'red'
  return 'neutral'
}

function getCategoryIcon(category: string): { icon: ReactNode; bg: string; text: string } {
  const norm = category.toLowerCase()
  if (norm.includes('salary') || norm.includes('income')) {
    return {
      bg: 'bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800',
      text: 'text-emerald-700 dark:text-emerald-400',
      icon: (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
    }
  }
  if (norm.includes('food') || norm.includes('dining')) {
    return {
      bg: 'bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800',
      text: 'text-amber-700 dark:text-amber-400',
      icon: (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 8.25v-1.5m-6 1.5v-1.5m12 9.75-1.5.75a3.354 3.354 0 0 1-3 0 3.354 3.354 0 0 0-3 0 3.354 3.354 0 0 1-3 0 3.354 3.354 0 0 0-3 0 3.354 3.354 0 0 1-3 0L3 18" />
        </svg>
      ),
    }
  }
  if (norm.includes('transport')) {
    return {
      bg: 'bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800',
      text: 'text-indigo-700 dark:text-indigo-400',
      icon: (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.25V3.75a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 3.75v10.5a1.5 1.5 0 0 0 1.5 1.5h1.5" />
        </svg>
      ),
    }
  }
  if (norm.includes('bill')) {
    return {
      bg: 'bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800',
      text: 'text-sky-700 dark:text-sky-400',
      icon: (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
        </svg>
      ),
    }
  }
  if (norm.includes('shopping')) {
    return {
      bg: 'bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800',
      text: 'text-rose-700 dark:text-rose-400',
      icon: (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
        </svg>
      ),
    }
  }
  // Default Transfer / P2P
  return {
    bg: 'bg-teal-50 dark:bg-teal-950 border border-teal-200 dark:border-teal-800',
    text: 'text-teal-700 dark:text-teal-400',
    icon: (
      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  }
}

export function TransactionRow({ row, onOpenShield, onEditCategory, onSelectRow }: Props) {
  const { hideBalance } = useBalancePrivacy()
  const incoming = row.direction === 'incoming'
  const unverified = row.verification === 'unverified'
  const isInternal = Boolean(
    row.is_internal ||
    (row.counterparty?.startsWith('Split-Receive to') && !row.counterparty?.includes('Fatima') && !row.counterparty?.includes('Beneficiary')) ||
    row.counterparty?.startsWith('Split-Receive from')
  )
  const catTheme = isInternal
    ? {
        bg: 'bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800',
        text: 'text-purple-700 dark:text-purple-300',
        icon: (
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
        ),
      }
    : getCategoryIcon(row.category)

  return (
    <li
      onClick={() => onSelectRow?.(row)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === '') {
          onSelectRow?.(row)
        }
      }}
      tabIndex={onSelectRow ? 0 : undefined}
      className={cx(
        'group flex items-center justify-between gap-3.5 py-3.5 px-3 -mx-3 rounded-2xl transition-colors hover:bg-slate-50 dark:hover:bg-slate-800',
        onSelectRow && 'cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-teal-500'
      )}
    >
      {/* LEFT: Category Icon & Details */}
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cx(
            'flex size-10 shrink-0 items-center justify-center rounded-2xl',
            catTheme.bg,
            catTheme.text,
          )}
        >
          {catTheme.icon}
        </div>

        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
              {row.counterparty ?? row.category}
            </p>
            {incoming && !unverified && (
              <span className="shrink-0 size-1.5 rounded-full bg-emerald-500" title="Settled deposit" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
              {row.bank_name}
            </span>

            {isInternal && (
              <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 px-2 py-0.5 text-[11px] font-bold text-purple-700 dark:text-purple-300">
                <svg className="size-3" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
                <span>Internal Transfer</span>
              </span>
            )}

            {onEditCategory ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onEditCategory(row)
                }}
                className="cursor-pointer transition-opacity hover:opacity-80"
                title="Click to change category"
              >
                <Badge tone={getCategoryTone(row.category)}>{row.category}</Badge>
              </button>
            ) : (
              <Badge tone={getCategoryTone(row.category)}>{row.category}</Badge>
            )}

            {row.created_at && (
              <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                {timeAgo(row.created_at)}
              </span>
            )}
          </div>

          {unverified && (
            <div className="space-y-1 pt-0.5">
              <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-400 flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-amber-500" />
                Unverified Credit. Potential scam or reversal.
              </p>
              {incoming && onOpenShield && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenShield(row)
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-2.5 py-1 text-[11px] font-bold text-amber-900 dark:text-amber-300 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900"
                >
                  Return request received? Shield money
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Transaction Amount */}
      <div className="text-right shrink-0">
        <p
          className={cx(
            'text-sm sm:text-base font-bold tabular-nums tracking-tight',
            isInternal
              ? 'text-purple-700 dark:text-purple-300'
              : incoming
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-900 dark:text-white',
            unverified && 'opacity-80',
          )}
        >
          {incoming ? '+' : ''}
          {formatKobo(row.amount_kobo, hideBalance)}
        </p>
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {isInternal ? (incoming ? 'Self Inflow' : 'Self Outflow') : (incoming ? 'Credit' : 'Debit')}
        </span>
      </div>
    </li>
  )
}
