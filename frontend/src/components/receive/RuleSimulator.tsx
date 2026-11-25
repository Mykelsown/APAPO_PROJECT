import { formatKobo } from '../../lib/money'
import type { RulesForm } from './useRulesForm'
import { Card } from '../ui'

const BRANCH_TONES = [
  'border-blue-500 bg-blue-500/10 text-blue-300',
  'border-purple-500 bg-purple-500/10 text-purple-300',
  'border-amber-500 bg-amber-500/10 text-amber-300',
  'border-cyan-500 bg-cyan-500/10 text-cyan-300',
]

const PRESETS = ['50,000', '100,000', '250,000', '1,000,000']

/** Live preview of how a hypothetical deposit would be split by the draft rules. */
export function RuleSimulator({ form }: { form: Pick<RulesForm, 'accounts' | 'receivingId' | 'destinations' | 'simNaira' | 'setSimNaira' | 'testKobo'> }) {
  const { accounts, receivingId, destinations, simNaira, setSimNaira, testKobo } = form
  const sourceName = accounts.find((a) => a.account_id === receivingId)?.bank_name

  const distributedKobo = destinations.reduce((sum, d) => {
    if (d.percent) return sum + Math.round((testKobo * d.percent) / 100)
    if (d.fixed_kobo) return sum + Math.min(d.fixed_kobo, testKobo)
    return sum
  }, 0)
  const retainedKobo = Math.max(0, testKobo - distributedKobo)
  const retainedPct = testKobo > 0 ? Math.round((retainedKobo / testKobo) * 100) : 0

  return (
    <Card className="relative overflow-hidden space-y-4 bg-[#042f2e] border border-teal-800 p-5 text-white">
      <div className="relative z-10 flex items-center justify-between border-b border-teal-800 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-400" />
            Interactive Rule Simulator
          </h2>
          <span className="text-[11px] text-teal-200/70">Live split computation preview</span>
        </div>
        <span className="rounded-full bg-teal-900 border border-teal-700 px-2.5 py-0.5 text-[10px] font-semibold text-teal-200">
          Live
        </span>
      </div>

      <div className="relative z-10 flex items-center gap-2">
        <label htmlFor="sim-input" className="text-xs font-semibold text-white/80">
          Hypothetical Deposit: ₦
        </label>
        <input
          id="sim-input"
          type="text"
          value={simNaira}
          onChange={(e) => setSimNaira(e.target.value)}
          className="w-36 rounded-xl border border-teal-700 bg-teal-950 px-3 py-1.5 text-xs font-bold text-white focus:outline-hidden focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
        />
      </div>

      {/* Quick Presets */}
      <div className="relative z-10 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-teal-200/70">Presets:</span>
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setSimNaira(p)}
            className="rounded-lg bg-teal-900 hover:bg-teal-800 px-2 py-0.5 text-[11px] font-semibold text-white transition-colors"
          >
            ₦{p}
          </button>
        ))}
      </div>

      {/* VISUAL SETTLEMENT FLOWCHART */}
      <div className="relative z-10 space-y-3 rounded-2xl border border-teal-800 bg-teal-950 p-4">
        {/* Source Node */}
        <div className="rounded-xl border border-emerald-500 bg-emerald-500/10 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-400" />
            <div>
              <p className="text-xs font-semibold text-white">Inflow: {sourceName ?? 'Source Bank'}</p>
              <p className="text-[10px] text-emerald-300">NIP Direct Credit Webhook</p>
            </div>
          </div>
          <span className="font-mono text-sm font-bold text-emerald-400">{formatKobo(testKobo)}</span>
        </div>

        {/* Flow Connector Arrow */}
        <div className="flex items-center justify-center -my-1 text-white/40">
          <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
          </svg>
        </div>

        {/* Branch Nodes */}
        <div className="space-y-2">
          {destinations.map((d, i) => {
            let shareKobo = 0
            if (d.percent) shareKobo = Math.round((testKobo * d.percent) / 100)
            else if (d.fixed_kobo) shareKobo = Math.min(d.fixed_kobo, testKobo)
            const pct = d.percent ?? (testKobo > 0 ? Math.round((shareKobo / testKobo) * 100) : 0)
            const name = d.beneficiary
              ? d.beneficiary.account_name
              : accounts.find((a) => a.account_id === d.account_id)?.bank_name ?? 'Destination Account'

            return (
              <div key={i} className={`rounded-xl border p-2.5 space-y-1.5 transition-all ${BRANCH_TONES[i % 4]}`}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-current" />
                    <span>{name}</span>
                  </span>
                  <div className="text-right">
                    <span className="font-bold tabular-nums text-white">{formatKobo(shareKobo)}</span>
                    <span className="ml-1.5 text-[11px] font-semibold text-white/70">({pct}%)</span>
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, pct)}%` }}
                    className="h-full bg-current rounded-full transition-all duration-300"
                  />
                </div>
              </div>
            )
          })}

          {/* Retained in Source Account Node */}
          <div className="rounded-xl border border-emerald-500 bg-emerald-500/10 p-2.5 space-y-1.5 text-emerald-300">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                <span>Retained in {sourceName ?? 'Source'}</span>
              </span>
              <div className="text-right">
                <span className="font-bold tabular-nums text-white">{formatKobo(retainedKobo)}</span>
                <span className="ml-1.5 text-[11px] font-semibold text-white/70">({retainedPct}%)</span>
              </div>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                style={{ width: `${Math.min(100, retainedPct)}%` }}
                className="h-full bg-emerald-400 rounded-full transition-all duration-300"
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
