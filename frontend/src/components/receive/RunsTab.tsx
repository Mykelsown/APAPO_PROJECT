import type { Account, SplitReceiveRun } from '../../api/types'
import { formatKobo } from '../../lib/money'
import { timeAgo } from '../../lib/time'
import { Badge, Button, Card } from '../ui'

// The mock reports a sent share as "settled", the real backend as "collected".
const SENT_STATES = ['settled', 'collected']

interface Props {
  runs: SplitReceiveRun[]
  accounts: Account[]
  onRetry: (runId: string) => void
}

export function RunsTab({ runs, accounts, onRetry }: Props) {
  return (
    <div className="space-y-3">
      {runs.length === 0 ? (
        <Card className="py-12 text-center dark:bg-slate-900 dark:border-slate-800">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">No Split-Receive runs yet</p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 font-medium">
            Trigger a confirmed credit using the demo toolbar above to see incoming splits in action.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {runs.map((r) => {
            const receivingAcct = accounts.find((a) => a.account_id === r.account_id)
            const hasFailure = r.legs.some((l) => l.state === 'failed')
            const totalDisbursed = r.legs.reduce((sum, l) => sum + l.amount_kobo, 0)
            const retainedKobo = Math.max(0, r.amount_kobo - totalDisbursed)
            return (
              <Card key={r.id} className="space-y-3 flex flex-col justify-between dark:bg-slate-900 dark:border-slate-800">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">{timeAgo(r.received_at)}</p>
                      <p className="text-base font-bold tabular-nums text-slate-900 dark:text-white">
                        +{formatKobo(r.amount_kobo)} received
                      </p>
                      <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                        Into {receivingAcct?.bank_name ?? 'Receiving Account'}
                      </p>
                    </div>
                    <Badge tone={r.state === 'settled' ? 'green' : r.state === 'needs_attention' ? 'red' : 'amber'}>
                      {r.state}
                    </Badge>
                  </div>

                  <div className="space-y-2 rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-xs">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 pb-1 border-b border-slate-200 dark:border-slate-700">
                      <span>Disbursements ({r.legs.length})</span>
                      <span>Amount</span>
                    </div>

                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {r.legs.map((leg) => {
                        const legName = leg.destination.beneficiary
                          ? leg.destination.beneficiary.account_name
                          : accounts.find((a) => a.account_id === leg.destination.account_id)?.bank_name ?? 'Account'
                        return (
                          <div key={leg.id} className="flex items-center justify-between py-1.5">
                            <div>
                              <span className="font-semibold text-slate-900 dark:text-white">Disbursed to {legName}</span>
                              <span className="ml-2 text-slate-600 dark:text-slate-400 font-medium">fee {formatKobo(leg.fee_kobo)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold tabular-nums text-slate-900 dark:text-white">
                                {formatKobo(leg.amount_kobo)}
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  SENT_STATES.includes(leg.state)
                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                                    : 'bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/60'
                                }`}
                              >
                                {leg.state}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700 text-xs">
                      <span className="font-semibold text-slate-600 dark:text-slate-400">
                        Retained in {receivingAcct?.bank_name ?? 'Source'}:
                      </span>
                      <span className="font-bold tabular-nums text-teal-700 dark:text-teal-400">
                        {formatKobo(retainedKobo)}
                      </span>
                    </div>
                  </div>
                </div>

                {hasFailure && (
                  <Button variant="secondary" block onClick={() => onRetry(r.id)} className="text-xs text-red-700 hover:text-red-900">
                    Retry failed split transfers
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
