import type { RulesForm as RulesFormState } from './useRulesForm'
import { Card } from '../ui'
import { RuleFlowDiagram } from './RuleFlowDiagram'
import { RuleSimulator } from './RuleSimulator'
import { RulesForm } from './RulesForm'

export function RulesTab({ form }: { form: RulesFormState }) {
  const receivingAccount = form.accounts.find((a) => a.account_id === form.receivingId)

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-12 lg:gap-8 lg:space-y-0 lg:items-start">
      {/* Left Column: Configuration Forms */}
      <RulesForm form={form} />

      {/* Right Column: Visual Architecture Flow & Live Interactive Simulator */}
      <div className="space-y-4 lg:col-span-5 lg:sticky lg:top-20">
        <RuleFlowDiagram
          receivingAccount={receivingAccount}
          destinations={form.destinations}
          accounts={form.accounts}
          totalPercent={form.totalPercent}
        />

        <RuleSimulator form={form} />

        <Card className="space-y-2.5 bg-slate-900 text-white p-5 rounded-2xl border border-slate-800">
          <h3 className="text-xs font-semibold text-slate-400">Apapo Guarantee</h3>
          <ul className="space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 font-bold">✓</span>
              <span>Double-entry balance verification on every credit.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 font-bold">✓</span>
              <span>Automated distribution capped strictly at 100%.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 font-bold">✓</span>
              <span>Unverified or flagged credits are held safely without auto-splitting.</span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
