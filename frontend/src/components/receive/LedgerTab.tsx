import type { Account, ReconciliationResponse } from '../../api/types'
import { ledgerToCsv } from '../../lib/ledgerCsv'
import { formatKobo } from '../../lib/money'
import { timeAgo } from '../../lib/time'
import { Card, useToast } from '../ui'

interface Props {
  reconciliation: ReconciliationResponse
  accounts: Account[]
}

export function LedgerTab({ reconciliation, accounts }: Props) {
  const toast = useToast()
  const { totals } = reconciliation

  function exportLedgerCsv() {
    const now = new Date()
    const blob = new Blob([ledgerToCsv(reconciliation, now)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `apapo-settlement-ledger-${now.toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    toast.show('Settlement ledger exported as CSV.', 'success')
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 bg-slate-900 text-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Settlement Summary</h2>
          <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
            Double-Entry Verified
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
          <div className="rounded-xl bg-slate-800 p-3">
            <p className="text-[11px] text-slate-400">Total Inflow</p>
            <p className="mt-1 text-base sm:text-lg font-bold tabular-nums">{formatKobo(totals.credit_kobo)}</p>
          </div>
          <div className="rounded-xl bg-slate-800 p-3">
            <p className="text-[11px] text-slate-400">Auto Distributed</p>
            <p className="mt-1 text-base sm:text-lg font-bold tabular-nums text-emerald-400">{formatKobo(totals.sent_kobo)}</p>
          </div>
          <div className="rounded-xl bg-slate-800 p-3">
            <p className="text-[11px] text-slate-400">Kept in Source</p>
            <p className="mt-1 text-base sm:text-lg font-bold tabular-nums text-sky-300">{formatKobo(totals.kept_kobo)}</p>
          </div>
          <div className="rounded-xl bg-slate-800 p-3">
            <p className="text-[11px] text-slate-400">Platform Fees</p>
            <p className="mt-1 text-base sm:text-lg font-bold tabular-nums text-amber-300">{formatKobo(totals.fees_kobo)}</p>
          </div>
        </div>

        <p className="border-t border-slate-800 pt-2 text-[11px] text-slate-400">
          Formula invariant: Sent ({formatKobo(totals.sent_kobo)}) + Kept ({formatKobo(totals.kept_kobo)}) = Total Credits (
          {formatKobo(totals.credit_kobo)}).
        </p>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Credit Reconciliation Records</h3>
          <button
            type="button"
            onClick={exportLedgerCsv}
            className="rounded-lg bg-slate-200 dark:bg-slate-700 px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
          >
            Export CSV
          </button>
        </div>
        {reconciliation.credits.length === 0 ? (
          <Card className="py-8 text-center text-xs text-slate-600 dark:text-slate-400">No reconciliation records found.</Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {reconciliation.credits.map((rec) => (
              <Card key={rec.run_id} className="space-y-2 dark:bg-slate-900 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">{timeAgo(rec.received_at)}</p>
                    <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">Credit: {formatKobo(rec.amount_kobo)}</p>
                  </div>
                  {rec.balanced && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
                      Balanced
                    </span>
                  )}
                </div>

                <div className="space-y-1 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs">
                  {rec.entries.map((entry, idx) => {
                    const label =
                      entry.kind === 'kept'
                        ? 'Retained in receiving account'
                        : entry.destination?.beneficiary
                          ? `Sent to ${entry.destination.beneficiary.account_name}`
                          : `Sent to ${
                              accounts.find((a) => a.account_id === entry.destination?.account_id)?.bank_name ?? 'Destination'
                            }`
                    return (
                      <div key={idx} className="flex justify-between py-0.5 text-slate-800 dark:text-slate-200">
                        <span className="truncate pr-2 font-medium">{label}</span>
                        <span className="font-bold tabular-nums text-slate-900 dark:text-white shrink-0">
                          {formatKobo(entry.amount_kobo)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
