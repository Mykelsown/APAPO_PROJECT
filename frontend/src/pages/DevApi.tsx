import { useState } from 'react'
import { api, apiMode, demo } from '../api/client'
import { toApiError } from '../api/errors'
import { session } from '../api/session'
import { Button, Card, RiskBadge } from '../components/ui'
import { demoPayees } from '../lib/demoPayees'
import { formatKobo } from '../lib/money'

type Call = [label: string, run: () => Promise<unknown>]

const [LOW, UNKNOWN, HIGH] = demoPayees(apiMode).map((d) => d.recipient)

const calls: Call[] = [
  ['auth.sendOtp', () => api.auth.sendOtp('+2348012345678')],
  [
    'auth.verifyOtp',
    async () => {
      const r = await api.auth.verifyOtp('+2348012345678', '123456')
      session.set(r.token)
      return r
    },
  ],
  ['auth.submitBvn', () => api.auth.submitBvn('22552255225')],
  ['auth.setPin', () => api.auth.setPin({ pin: '1234', confirm_pin: '1234' })],
  ['auth.refresh', () => api.auth.refresh()],
  ['banks.supported', () => api.banks.supported()],
  ['banks.linked', () => api.banks.linked()],
  ['banks.link', () => api.banks.link({ bank_name: 'GTBank', consent: true })],
  ['accounts.list', () => api.accounts.list()],
  ['dashboard.get', () => api.dashboard.get()],
  ['splitPay.preview (3 legs)', () => api.splitPay.preview({ amount_kobo: 15_000_000, recipient: LOW })],
  ['splitPay.preview (high risk)', () => api.splitPay.preview({ amount_kobo: 100_000, recipient: HIGH })],
  [
    'splitPay.execute + status',
    async () => {
      const key = crypto.randomUUID()
      const ex = await api.splitPay.execute({ amount_kobo: 15_000_000, recipient: LOW, pin: '4821' }, key)
      return api.splitPay.status(ex.payment_id)
    },
  ],
  ['safeSend.riskCheck', () => api.safeSend.riskCheck({ recipient: UNKNOWN, amount_kobo: 5000 })],
  ['safeSend.shieldCheck', () => api.safeSend.shieldCheck()],
  ['safeSend.shieldDismiss', () => api.safeSend.shieldDismiss('PAY-0001')],
  [
    'safeSend.report',
    () =>
      api.safeSend.report({
        recipient: { bank_code: 'zenith', account_number: '1000000003' },
        evidence_ref: 'TXN-002',
      }),
  ],
  ['splitReceive.getRules', () => api.splitReceive.getRules()],
  ['splitReceive.runs', () => api.splitReceive.runs()],
  ['splitReceive.reconciliation', () => api.splitReceive.reconciliation()],
  ['splitReceive.simulateCredit', () => api.splitReceive.simulateCredit({ amount_kobo: 10_000_000, sender_name: 'Ada Stores' })],
  ['insights.shifts', () => api.insights.shifts()],
  ['security.audit', () => api.security.audit()],
  ['security.getLimits', () => api.security.getLimits()],
  ['security.sessions', () => api.security.sessions()],
]

export function DevApi() {
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState(demo.forceFailure)

  async function run([label, fn]: Call) {
    setBusy(true)
    try {
      setOut(`${label}\n${JSON.stringify(await fn(), null, 2)}`)
    } catch (e) {
      const err = toApiError(e)
      setOut(`${label}\nERROR ${err.code}: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 pt-2">
      <div className="space-y-4 lg:grid lg:grid-cols-12 lg:gap-6 lg:space-y-0 lg:items-start">
        <div className="space-y-4 lg:col-span-7">
          <Card className="space-y-2 p-4 dark:bg-slate-900 dark:border-slate-800">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">API Explorer</h1>
            <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 font-medium">Mode: <span className="font-semibold text-slate-900 dark:text-white">{apiMode}</span>. Run verifyOtp first to sign in.</p>
            <p className="flex items-center gap-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
              Sample: {formatKobo(12_345_678)} <RiskBadge tier="unknown" />
            </p>
            {apiMode === 'mock' && (
              <label className="flex items-center gap-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={fail}
                  onChange={(e) => {
                    demo.forceFailure = e.target.checked
                    setFail(e.target.checked)
                  }}
                  className="rounded border-slate-300 dark:border-slate-600 text-teal-600 focus:ring-teal-600"
                />
                Force next payment to fail (rollback restitution demo)
              </label>
            )}
          </Card>

          <Card className="space-y-3 p-4 dark:bg-slate-900 dark:border-slate-800">
            <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Endpoint Triggers</h2>
            <div className="flex flex-wrap gap-2">
              {calls.map((c) => (
                <Button key={c[0]} variant="secondary" disabled={busy} onClick={() => run(c)} className="text-xs">
                  {c[0]}
                </Button>
              ))}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-5 lg:sticky lg:top-20">
          <div className="rounded-2xl bg-slate-900 p-4 text-xs font-mono text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
              <span className="text-[10px] font-medium text-slate-400">Console Response</span>
              <button
                type="button"
                onClick={() => setOut('')}
                className="text-[10px] text-slate-400 hover:text-white"
              >
                Clear
              </button>
            </div>
            <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap leading-relaxed">
              {out || '// Click any endpoint on the left to execute and view JSON response.'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
