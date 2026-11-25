import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, apiMode, demo } from '../../api/client'
import { toApiError } from '../../api/errors'
import type { PaymentStatus, PreviewResponse, Recipient } from '../../api/types'
import { useToast } from '../../components/ui'
import { describeRecipient } from '../../lib/demoPayees'
import { AmountStep } from './AmountStep'
import { PinStep } from './PinStep'
import { PreviewStep } from './PreviewStep'
import { ProgressStep } from './ProgressStep'
import { ResultStep } from './ResultStep'

type Step = 'form' | 'preview' | 'pin' | 'progress' | 'result'

const titles: Record<Step, string> = {
  form: 'Split-Pay',
  preview: 'Review payment',
  pin: 'Confirm',
  progress: 'Paying',
  result: 'Result',
}

interface Draft {
  amountText: string
  recipient?: Recipient
}

export function SplitPay() {
  const nav = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState<Step>('form')
  const [draft, setDraft] = useState<Draft>({ amountText: '' })
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [result, setResult] = useState<PaymentStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  // One key per confirmed plan. Retries after a network error reuse it so the backend cannot double charge.
  const idemKey = useRef<string | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  function startLongPress() {
    if (apiMode !== 'mock') return
    pressTimer.current = setTimeout(() => {
      demo.forceFailure = !demo.forceFailure
      toast.show(demo.forceFailure ? 'Demo: next payment will fail' : 'Demo: failure mode off')
    }, 800)
  }
  const cancelLongPress = () => clearTimeout(pressTimer.current)

  function reset() {
    setStep('form')
    setPreview(null)
    setPaymentId(null)
    setResult(null)
    setError(undefined)
    idemKey.current = null
  }

  function fail(e: unknown): string {
    const err = toApiError(e)
    if (err.code === 'UNAUTHORIZED') toast.show('Your session expired. Please sign in again.', 'error')
    return err.message
  }

  async function getPreview(amountKobo: number, recipient: Recipient, amountText: string) {
    setBusy(true)
    setError(undefined)
    try {
      const p = await api.splitPay.preview({ amount_kobo: amountKobo, recipient })
      setDraft({ amountText, recipient })
      setPreview(p)
      idemKey.current = null
      setStep('preview')
    } catch (e) {
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }

  async function execute(pin: string) {
    if (!preview || !draft.recipient) return
    setBusy(true)
    setError(undefined)
    idemKey.current ??= crypto.randomUUID()
    try {
      const res = await api.splitPay.execute(
        { amount_kobo: preview.total_amount_kobo, recipient: draft.recipient, pin },
        idemKey.current,
      )
      setPaymentId(res.payment_id)
      setStep('progress')
    } catch (e) {
      setError(fail(e))
    } finally {
      setBusy(false)
    }
  }

  const recipientLabel = draft.recipient ? describeRecipient(draft.recipient) : ''

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-2">
      <div className="flex items-center justify-between">
        <h1
          className="select-none text-xl sm:text-2xl font-bold text-slate-900 dark:text-white"
          onPointerDown={startLongPress}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onContextMenu={(e) => e.preventDefault()}
        >
          {titles[step]}
        </h1>
        {step !== 'form' && step !== 'result' && (
          <button
            type="button"
            onClick={reset}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
          >
            Cancel payment
          </button>
        )}
      </div>

      {step === 'form' && (
        <AmountStep
          initialAmount={draft.amountText}
          initialRecipient={draft.recipient}
          loading={busy}
          error={error}
          onSubmit={getPreview}
        />
      )}
      {step === 'preview' && preview && (
        <PreviewStep
          preview={preview}
          recipient={recipientLabel}
          onBack={() => setStep('form')}
          onContinue={(updatedPreview?: PreviewResponse) => {
            if (updatedPreview) setPreview(updatedPreview)
            setStep('pin')
          }}
        />
      )}
      {step === 'pin' && preview && (
        <PinStep
          total={preview.total_amount_kobo + preview.total_fee_kobo}
          loading={busy}
          error={error}
          onBack={() => {
            setError(undefined)
            setStep('preview')
          }}
          onConfirm={execute}
        />
      )}
      {step === 'progress' && paymentId && preview && (
        <ProgressStep
          paymentId={paymentId}
          planned={preview.legs}
          onDone={(s) => {
            setResult(s)
            setStep('result')
          }}
        />
      )}
      {step === 'result' && result && preview && (
        <ResultStep
          status={result}
          preview={preview}
          recipient={recipientLabel}
          onRetry={() => {
            // Same plan, but a failed payment is a new attempt and needs a fresh key.
            idemKey.current = null
            setPaymentId(null)
            setResult(null)
            setStep('pin')
          }}
          onDone={() => {
            reset()
            nav('/')
          }}
        />
      )}
    </div>
  )
}
