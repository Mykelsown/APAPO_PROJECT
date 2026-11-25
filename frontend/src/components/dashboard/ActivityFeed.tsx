import { useMemo, useState } from 'react'
import type { FeedRow } from '../../api/types'
import { formatKobo } from '../../lib/money'
import { Button, Card, cx, useToast } from '../ui'
import { TransactionReceiptModal } from './TransactionReceiptModal'
import { TransactionRow } from './TransactionRow'

const PAGE = 15

type DirectionFilter = 'all' | 'inflow' | 'outflow' | 'internal'

interface Props {
  transactions: FeedRow[]
  bankNames: string[]
  onOpenShield: (row: FeedRow) => void
  onEditCategory: (row: FeedRow) => void
}

function isInternalRow(r: FeedRow): boolean {
  return Boolean(
    r.is_internal ||
    (r.counterparty?.startsWith('Split-Receive to') && !r.counterparty?.includes('Fatima') && !r.counterparty?.includes('Beneficiary')) ||
    r.counterparty?.startsWith('Split-Receive from')
  )
}

function getDateGroupLabel(dateStr?: string): string {
  if (!dateStr) return 'Recent Activity'
  const txDate = new Date(dateStr)
  if (isNaN(txDate.getTime())) return 'Recent Activity'

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const txTime = txDate.getTime()

  if (txTime >= startOfToday) {
    return 'Today'
  }
  const startOfYesterday = startOfToday - 86_400_000
  if (txTime >= startOfYesterday) {
    return 'Yesterday'
  }
  const oneWeekAgo = startOfToday - 7 * 86_400_000
  if (txTime >= oneWeekAgo) {
    return 'Earlier This Week'
  }
  return txDate.toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })
}

/** The unified transaction list with search, bank & direction filters, date grouping, CSV export, and receipt modal. */
export function ActivityFeed({ transactions, bankNames, onOpenShield, onEditCategory }: Props) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [bank, setBank] = useState<string | null>(null)
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [shown, setShown] = useState(PAGE)
  const [receiptRow, setReceiptRow] = useState<FeedRow | null>(null)

  const feed = useMemo(() => {
    const rows = [...transactions].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      const matchBank = !bank || r.bank_name === bank
      const matchQuery = !q || `${r.counterparty ?? ''} ${r.category} ${r.bank_name}`.toLowerCase().includes(q)
      if (!matchBank || !matchQuery) return false

      const internal = isInternalRow(r)
      if (direction === 'inflow') return r.direction === 'incoming' && !internal
      if (direction === 'outflow') return r.direction === 'outgoing' && !internal
      if (direction === 'internal') return internal
      return true
    })
  }, [transactions, query, bank, direction])

  const visibleRows = useMemo(() => feed.slice(0, shown), [feed, shown])

  const dateGroups = useMemo(() => {
    const groups: { label: string; rows: FeedRow[] }[] = []
    let currentLabel = ''
    let currentRows: FeedRow[] = []

    for (const row of visibleRows) {
      const label = getDateGroupLabel(row.created_at)
      if (label !== currentLabel) {
        if (currentRows.length > 0) {
          groups.push({ label: currentLabel, rows: currentRows })
        }
        currentLabel = label
        currentRows = [row]
      } else {
        currentRows.push(row)
      }
    }
    if (currentRows.length > 0) {
      groups.push({ label: currentLabel, rows: currentRows })
    }
    return groups
  }, [visibleRows])

  function handleExportCSV() {
    if (feed.length === 0) {
      toast.show('No transactions to export.', 'info')
      return
    }

    const headers = ['ID', 'Date', 'Bank', 'Counterparty', 'Direction', 'Category', 'Amount Kobo', 'Amount NGN', 'Status', 'Is Internal']
    const lines = feed.map((r) => {
      const internal = isInternalRow(r)
      const dir = internal ? 'Internal' : r.direction === 'incoming' ? 'Inflow' : 'Outflow'
      return [
        `"${r.id}"`,
        `"${r.created_at ?? ''}"`,
        `"${r.bank_name}"`,
        `"${r.counterparty ?? ''}"`,
        `"${dir}"`,
        `"${r.category}"`,
        r.amount_kobo,
        `"${formatKobo(r.amount_kobo)}"`,
        `"${r.verification ?? 'verified'}"`,
        internal ? 'true' : 'false',
      ].join(',')
    })

    const csvContent = [headers.join(','), ...lines].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `apapo-activity-${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.show(`Exported ${feed.length} transactions to CSV.`, 'success')
  }

  return (
    <section aria-labelledby="feed-title" className="space-y-4 lg:col-span-8">
      {/* Header and Entry Count / Export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="feed-title" className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
            Live Transaction Activity
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Unified feed across all linked accounts</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCSV}
            title="Download visible transactions as CSV"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <svg className="size-3.5 text-teal-600 dark:text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <span>Export CSV</span>
          </button>

          <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-300">
            {feed.length} entries
          </span>
        </div>
      </div>

      {/* Search Input & Bank Filter Tabs */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500 dark:text-slate-400">
            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </span>
          <label htmlFor="feed-search" className="sr-only">
            Search transactions
          </label>
          <input
            id="feed-search"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setShown(PAGE)
            }}
            placeholder="Search transactions by merchant, category or bank"
            className="min-h-11 w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-10 pr-4 text-xs text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:border-teal-600 focus:outline-hidden focus:ring-2 focus:ring-teal-600/20 transition-all"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0" role="group" aria-label="Filter by bank">
          {[null, ...bankNames].map((b) => (
            <button
              key={b ?? 'all'}
              type="button"
              aria-pressed={bank === b}
              onClick={() => {
                setBank(b)
                setShown(PAGE)
              }}
              className={cx(
                'min-h-10 shrink-0 rounded-xl px-3.5 text-xs font-bold transition-all cursor-pointer',
                bank === b
                  ? 'bg-slate-900 dark:bg-slate-800 text-white'
                  : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
              )}
            >
              {b ?? 'All Banks'}
            </button>
          ))}
        </div>
      </div>

      {/* Direction Filter Chips */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5" role="group" aria-label="Filter by direction">
        <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 mr-1">Direction:</span>
        {(
          [
            { id: 'all', label: 'All' },
            { id: 'inflow', label: 'Inflows (+)' },
            { id: 'outflow', label: 'Outflows (-)' },
            { id: 'internal', label: 'Internal (⇄)' },
          ] as const
        ).map((d) => (
          <button
            key={d.id}
            type="button"
            aria-pressed={direction === d.id}
            onClick={() => {
              setDirection(d.id)
              setShown(PAGE)
            }}
            className={cx(
              'rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer',
              direction === d.id
                ? 'bg-teal-700 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700',
            )}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Transaction List with Date Grouping */}
      <Card className="divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden p-0 border border-slate-200 dark:border-slate-800">
        {feed.length === 0 ? (
          <div className="py-16 text-center space-y-1">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No activity found</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">
              {transactions.length === 0 ? 'No activity yet.' : 'Nothing matches your search filter.'}
            </p>
          </div>
        ) : (
          <div className="px-4 py-1 divide-y divide-slate-100 dark:divide-slate-800">
            {dateGroups.map((group) => (
              <div key={group.label} className="py-2 first:pt-1">
                <div className="flex items-center justify-between pb-1.5 pt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>{group.label}</span>
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    {group.rows.length} {group.rows.length === 1 ? 'transaction' : 'transactions'}
                  </span>
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {group.rows.map((r, i) => (
                    <TransactionRow
                      key={r.id ?? `${r.bank_name}-${i}`}
                      row={r}
                      onOpenShield={onOpenShield}
                      onEditCategory={onEditCategory}
                      onSelectRow={(selected) => setReceiptRow(selected)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      {feed.length > shown && (
        <Button variant="secondary" block onClick={() => setShown((n) => n + PAGE)} className="">
          Show more transactions ({feed.length - shown} remaining)
        </Button>
      )}

      {/* Transaction Receipt Modal */}
      <TransactionReceiptModal
        open={Boolean(receiptRow)}
        row={receiptRow}
        onClose={() => setReceiptRow(null)}
      />
    </section>
  )
}
