import type { Account, DestinationInput } from '../../api/types'
import { Card } from '../ui'

interface Props {
  receivingAccount: Account | undefined
  destinations: DestinationInput[]
  accounts: Account[]
  totalPercent: number
}

export function RuleFlowDiagram({ receivingAccount, destinations, accounts, totalPercent }: Props) {
  const retainedPercent = Math.max(0, 100 - totalPercent)
  const receivingBankName = receivingAccount?.bank_name ?? 'Primary Bank'
  const receivingMasked = receivingAccount?.masked_number ?? '••••'

  const accountMap = new Map(accounts.map((a) => [a.account_id, a]))

  return (
    <Card role="region" aria-label="Automated routing architecture diagram" className="space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <p className="sr-only">
        Split-receive rule routing: 100% arrives at {receivingBankName}, retaining {retainedPercent}%, with {destinations.length} configured outflow splits.
      </p>
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-2 rounded-full bg-teal-500" />
          <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            Automated Routing Architecture
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-bold text-slate-700 dark:text-slate-300">
          {destinations.length + 1} Paths
        </span>
      </div>

      {/* Interactive Flow Tree */}
      <div className="space-y-3 font-sans">
        {/* Step 1: Inflow Root */}
        <div className="rounded-2xl border border-teal-200 dark:border-teal-800/60 bg-teal-50 dark:bg-teal-950/60 p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-xl bg-teal-600 text-white font-bold text-xs">
              ↓
            </span>
            <div>
              <p className="text-xs font-bold text-teal-950 dark:text-teal-200">Incoming Verified Credit</p>
              <p className="text-[11px] text-teal-800 dark:text-teal-400">Arrives at {receivingBankName} ({receivingMasked})</p>
            </div>
          </div>
          <span className="rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-bold text-white">
            100%
          </span>
        </div>

        {/* Step 2: Distribution Branches */}
        <div className="pl-4 sm:pl-6 border-l-2 border-dashed border-teal-300 dark:border-teal-800 space-y-2.5 ml-3.5">
          {/* Main Retained Branch */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 text-[10px] font-bold">
                ✓
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  Retained in {receivingBankName}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                  Primary Operating Funds
                </p>
              </div>
            </div>
            <span className="rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 text-xs font-extrabold text-emerald-800 dark:text-emerald-300 shrink-0">
              {retainedPercent}%
            </span>
          </div>

          {/* Sub Target Branches */}
          {destinations.map((d, i) => {
            const destAccount = d.account_id ? accountMap.get(d.account_id) : undefined
            const name = d.beneficiary
              ? `${d.beneficiary.account_name} (${d.beneficiary.bank_code})`
              : destAccount
              ? `${destAccount.bank_name} (${destAccount.masked_number})`
              : `Target #${i + 1}`

            const isPct = d.percent !== undefined
            const valLabel = isPct ? `${d.percent}%` : `Fixed ₦`

            return (
              <div
                key={i}
                className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950 p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60 text-[10px] font-bold">
                    ⇄
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-purple-950 dark:text-purple-200 truncate">
                      Auto-Disburse to {name}
                    </p>
                    <p className="text-[10px] text-purple-800 dark:text-purple-400 font-medium">
                      {d.beneficiary ? 'External Beneficiary' : 'Internal Linked Account'}
                    </p>
                  </div>
                </div>
                <span className="rounded-md bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/60 px-2 py-0.5 text-xs font-extrabold text-purple-900 dark:text-purple-200 shrink-0">
                  {valLabel}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
