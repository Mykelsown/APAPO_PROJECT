import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { PaymentStatus, PreviewResponse } from '../../api/types'
import { ShareReceiptModal } from '../../components/pay/ShareReceiptModal'
import { Button, Card } from '../../components/ui'
import { formatKobo } from '../../lib/money'

interface Props {
  status: PaymentStatus
  preview: PreviewResponse
  recipient: string
  onRetry: () => void
  onDone: () => void
}

export function ResultStep({ status, preview, recipient, onRetry, onDone }: Props) {
  const [showShare, setShowShare] = useState(false)
  const [currentStatus, setCurrentStatus] = useState<PaymentStatus>(status)

  // Live auto-polling for "needs_attention" until background reversals complete into rolled_back
  useEffect(() => {
    if (currentStatus.state !== 'needs_attention') return
    let active = true
    const timer = setInterval(async () => {
      try {
        const next = await api.splitPay.status(currentStatus.payment_id)
        if (active && next.state !== currentStatus.state) {
          setCurrentStatus(next)
        }
      } catch {
        // network retry
      }
    }, 2000)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [currentStatus])

  if (currentStatus.state === 'completed') {
    return (
      <div className="space-y-4">
        <Card className="space-y-3 text-center">
          <div aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-2xl text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
            ✓
          </div>
          <h2 className="text-xl font-semibold">Payment sent</h2>
          <p className="text-3xl font-bold tabular-nums">{formatKobo(preview.total_amount_kobo)}</p>
          <p className="text-sm text-slate-700 dark:text-slate-300 font-medium">To {recipient}</p>
        </Card>
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Receipt</h3>
            <button
              type="button"
              onClick={() => setShowShare(true)}
              className="text-xs font-bold text-teal-700 dark:text-teal-400 hover:underline"
            >
              Share proof
            </button>
          </div>
          <dl className="space-y-1 text-sm">
            <Row k="Reference" v={currentStatus.payment_id} />
            {currentStatus.legs.map((l) => (
              <Row key={l.account_id} k={l.bank_name ?? l.account_id} v={formatKobo(l.amount_kobo)} />
            ))}
            <Row k="Fees" v={formatKobo(preview.total_fee_kobo)} />
            <Row k="Total charged" v={formatKobo(preview.total_amount_kobo + preview.total_fee_kobo)} bold />
          </dl>
        </Card>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowShare(true)} className="flex-1">
            Share Receipt
          </Button>
          <Button block onClick={onDone} className="flex-1">
            Done
          </Button>
        </div>

        <ShareReceiptModal
          open={showShare}
          status={currentStatus}
          preview={preview}
          recipient={recipient}
          onClose={() => setShowShare(false)}
        />
      </div>
    )
  }

  if (currentStatus.state === 'rolled_back') {
    return (
      <div className="space-y-4">
        <Card className="space-y-3 text-center">
          <div aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-sky-50 text-2xl text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60">
            ↺
          </div>
          <h2 className="text-xl font-semibold">Payment did not go through</h2>
          <p className="text-sm text-slate-700 dark:text-slate-300">{currentStatus.message || 'We reversed the earlier steps. Your money is back.'}</p>
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold">What happened</h3>
          <ul className="space-y-1 text-sm">
            {currentStatus.legs.map((l) => (
              <li key={l.account_id} className="flex justify-between">
                <span>{l.bank_name ?? l.account_id}</span>
                <span className="text-slate-700 dark:text-slate-300 font-medium">
                  {l.state === 'reversed' ? 'Returned' : l.state === 'failed' ? 'Could not be charged' : l.state}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onDone} className="flex-1">
            Close
          </Button>
          <Button onClick={onRetry} className="flex-1">
            Try again
          </Button>
        </div>
      </div>
    )
  }

  // needs_attention state (hold and background retry)
  return (
    <div className="space-y-4">
      <Card className="space-y-3 text-center border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20">
        <div aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-amber-100 text-2xl text-amber-700 dark:bg-amber-900/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
          ⏳
        </div>
        <h2 className="text-xl font-bold text-amber-950 dark:text-amber-200">Your money is safe</h2>
        <p className="text-sm text-amber-900/90 dark:text-amber-300">
          {currentStatus.message || 'We are still putting your funds back into your account.'}
        </p>
        <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 dark:bg-amber-900/40 px-3 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
          <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
          <span>Apapo is retrying reversals in background...</span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Reference {currentStatus.payment_id}. Funds remain in your linked account while retries proceed.
        </p>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-semibold">Leg Status</h3>
        <ul className="space-y-1.5 text-sm">
          {currentStatus.legs.map((l) => (
            <li key={l.account_id} className="flex items-center justify-between">
              <span>{l.bank_name ?? l.account_id}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                l.state === 'reversed'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : l.state === 'failed'
                  ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
              }`}>
                {l.state === 'reversed' ? 'Returned' : l.state === 'failed' ? 'Failed - Retrying Return' : l.state}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Button block variant="secondary" onClick={onDone}>
        Done
      </Button>
    </div>
  )
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={bold ? 'flex justify-between border-t border-slate-100 dark:border-slate-800 pt-1 font-semibold' : 'flex justify-between'}>
      <dt className="text-slate-700 dark:text-slate-300 font-medium">{k}</dt>
      <dd className="tabular-nums font-semibold">{v}</dd>
    </div>
  )
}

