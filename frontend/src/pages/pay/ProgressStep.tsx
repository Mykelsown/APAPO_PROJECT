import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { toApiError, type ApiError } from '../../api/errors'
import type { LegState, PaymentState, PaymentStatus, PreviewLeg } from '../../api/types'
import { ErrorState } from '../../components/ErrorState'
import { Card, cx } from '../../components/ui'
import { formatKobo } from '../../lib/money'

const TERMINAL: PaymentState[] = ['completed', 'rolled_back', 'needs_attention']
const POLL_MS = 900

const legText: Record<LegState, string> = {
  pending: 'Waiting',
  collected: 'Collected',
  failed: 'Failed',
  reversed: 'Returned',
}
const legTone: Record<LegState, string> = {
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
  collected: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60',
  failed: 'bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800/60',
  reversed: 'bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60',
}

interface Props {
  paymentId: string
  planned: PreviewLeg[]
  onDone: (status: PaymentStatus) => void
}

export function ProgressStep({ paymentId, planned, onDone }: Props) {
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function tick() {
      try {
        const s = await api.splitPay.status(paymentId)
        if (cancelled) return
        setStatus(s)
        setError(null)
        if (TERMINAL.includes(s.state)) {
          timer = setTimeout(() => !cancelled && doneRef.current(s), 700)
          return
        }
      } catch (e) {
        if (cancelled) return
        const err = toApiError(e)
        setError(err)
        if (err.code === 'UNAUTHORIZED' || err.code === 'NOT_FOUND') return
      }
      timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [paymentId, attempt])

  const rows =
    status?.legs ??
    planned.map((l) => ({ account_id: l.account_id, bank_name: l.bank_name, amount_kobo: l.amount_kobo, state: 'pending' as LegState }))
  const bankOf = (id: string) => planned.find((p) => p.account_id === id)?.bank_name ?? id

  return (
    <div className="space-y-4">
      <Card className="space-y-1 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-300" role="status" aria-live="polite">
          {status?.message ?? 'Starting your payment'}
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Please keep this screen open.</p>
      </Card>

      <Card>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((l) => (
            <li key={l.account_id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium">{('bank_name' in l && l.bank_name) || bankOf(l.account_id)}</p>
                <p className="text-sm tabular-nums text-slate-700 dark:text-slate-300 font-semibold">{formatKobo(l.amount_kobo)}</p>
              </div>
              <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-300', legTone[l.state])}>
                {legText[l.state]}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between py-3">
            <p className="text-sm font-medium">Send to recipient</p>
            <span
              className={cx(
                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                status?.state === 'sending' ? 'bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60' : status?.state === 'completed' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
              )}
            >
              {status?.state === 'completed' ? 'Sent' : status?.state === 'sending' ? 'Sending' : 'Waiting'}
            </span>
          </li>
        </ul>
      </Card>

      {error && <ErrorState error={error} onRetry={error.code === 'NETWORK_ERROR' ? () => setAttempt((n) => n + 1) : undefined} />}
    </div>
  )
}
