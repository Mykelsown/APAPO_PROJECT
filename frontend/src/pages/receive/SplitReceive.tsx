import { useState } from 'react'
import { api, apiMode } from '../../api/client'
import { toApiError } from '../../api/errors'
import { DemoCreditTriggers } from '../../components/receive/DemoCreditTriggers'
import { LedgerTab } from '../../components/receive/LedgerTab'
import { RunsTab } from '../../components/receive/RunsTab'
import { RulesTab } from '../../components/receive/RulesTab'
import { useRulesForm } from '../../components/receive/useRulesForm'
import { Skeleton, useToast } from '../../components/ui'
import { useAsync } from '../../lib/useAsync'

type Tab = 'rules' | 'runs' | 'ledger'

export function SplitReceive() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('rules')
  const [simulating, setSimulating] = useState(false)

  const { data, loading, reload } = useAsync(async () => {
    const [rulesRes, acctsRes, runsRes, recRes] = await Promise.all([
      api.splitReceive.getRules(),
      api.accounts.list(),
      api.splitReceive.runs(20),
      api.splitReceive.reconciliation(),
    ])
    return {
      rules: rulesRes.rules,
      accounts: acctsRes.accounts,
      runs: runsRes.runs,
      reconciliation: recRes,
    }
  })

  const form = useRulesForm(data, reload)

  async function handleSimulateCredit(verified: boolean, amountKobo: number) {
    setSimulating(true)
    try {
      const res = await api.splitReceive.simulateCredit({
        amount_kobo: amountKobo,
        sender_name: verified ? 'Ada Stores Ltd' : 'Unknown Sender',
        verified,
      })
      if (!verified) {
        toast.show('Simulated unverified credit arrived. It was safely ignored by rules.', 'info')
      } else if (res.scan && res.scan.new_runs.length > 0) {
        toast.show(`Simulated credit received. New split run created (${res.scan.new_runs[0]}).`, 'success')
        setTab('runs')
      } else {
        toast.show('Credit simulated successfully.', 'success')
      }
      await reload()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setSimulating(false)
    }
  }

  async function handleRetryLegs(runId: string) {
    try {
      await api.splitReceive.retryRun(runId)
      toast.show('Retried failed shares successfully.', 'success')
      await reload()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4 pt-2" aria-busy="true" aria-label="Loading Split-Receive">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const runs = data?.runs ?? []
  const tabs: { id: Tab; label: string }[] = [
    { id: 'rules', label: 'Rules' },
    { id: 'runs', label: `Runs (${runs.length})` },
    { id: 'ledger', label: 'Ledger' },
  ]

  return (
    <div className="space-y-6 pt-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Split-Receive</h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium">Auto-route incoming payments across accounts</p>
        </div>
        {form.rules?.active && (
          <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            <span className="size-2 rounded-full bg-emerald-600" />
            Rules Active
          </span>
        )}
      </div>

      {/* Mode Navigation Tabs */}
      <div className="flex max-w-md rounded-xl bg-slate-200 dark:bg-slate-800 p-1 text-xs sm:text-sm font-semibold">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg py-2 transition-colors ${
              tab === t.id
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {apiMode === 'mock' && <DemoCreditTriggers disabled={simulating} onSimulate={handleSimulateCredit} />}

      {tab === 'rules' && <RulesTab form={form} />}
      {tab === 'runs' && <RunsTab runs={runs} accounts={form.accounts} onRetry={handleRetryLegs} />}
      {tab === 'ledger' && data?.reconciliation && <LedgerTab reconciliation={data.reconciliation} accounts={form.accounts} />}
    </div>
  )
}
