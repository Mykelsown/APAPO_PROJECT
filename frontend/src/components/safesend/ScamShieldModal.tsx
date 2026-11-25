import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { toApiError } from '../../api/errors'
import { formatKobo } from '../../lib/money'
import { Button, Card, Input, useToast } from '../ui'

interface Props {
  open: boolean
  creditId?: string
  amountKobo?: number
  counterparty?: string
  onClose: () => void
  onContinueAnyway?: () => void
}

export function ScamShieldModal(props: Props) {
  // The body remounts each time the modal opens, so its countdown and form start fresh.
  return props.open ? <ScamShieldBody {...props} /> : null
}

function ScamShieldBody({
  creditId,
  amountKobo,
  counterparty,
  onClose,
  onContinueAnyway,
}: Props) {
  const toast = useToast()
  const [secondsLeft, setSecondsLeft] = useState(10)
  const [reporting, setReporting] = useState(false)
  const [reportEvidence, setReportEvidence] = useState('')
  const [reportAccount, setReportAccount] = useState('')
  const [reportBank, setReportBank] = useState('access')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  async function handleReport() {
    if (!reportEvidence.trim()) {
      toast.show('Please provide a reference or reason as evidence.', 'error')
      return
    }
    setSubmitting(true)
    try {
      await api.safeSend.report({
        recipient: {
          bank_code: reportBank,
          account_number: reportAccount || '0000000000',
        },
        evidence_ref: reportEvidence.trim(),
      })
      if (creditId) {
        await api.safeSend.shieldDismiss(creditId)
      }
      toast.show('Scam report submitted. Thank you for protecting the community.', 'success')
      setReporting(false)
      onClose()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shield-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900 p-4 sm:items-center"
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-400">
            <svg
              className="size-6"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285ZM12 16.5h.008v.008H12v-.008Z"
              />
            </svg>
          </div>
          <div>
            <h2 id="shield-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Wrong-Transfer Scam Shield
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Safe Send protection active</p>
          </div>
        </div>

        {amountKobo !== undefined && (
          <div className="mt-4 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/60 p-3 text-sm text-amber-950 dark:text-amber-200">
            <p className="font-medium">
              Flagged credit: {formatKobo(amountKobo)}
              {counterparty ? ` from ${counterparty}` : ''}
            </p>
            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
              This incoming transfer is not yet confirmed by the sending bank.
            </p>
          </div>
        )}

        {!reporting ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              If someone contacted you claiming they sent money by mistake and asked you to transfer it back, please
              pause. This is a common scam tactic.
            </p>

            <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-3.5 text-sm">
              <div className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200">
                  1
                </span>
                <p className="text-slate-800 dark:text-slate-200">
                  <strong>Do not send money back directly.</strong> Scammers ask you to transfer funds manually, then
                  ask their bank to reverse their initial deposit, debiting you twice.
                </p>
              </div>

              <div className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200">
                  2
                </span>
                <p className="text-slate-800 dark:text-slate-200">
                  <strong>Ask your bank to reverse it.</strong> Contact your bank and request an official reversal of
                  the unexpected transfer.
                </p>
              </div>

              <div className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200">
                  3
                </span>
                <p className="text-slate-800 dark:text-slate-200">
                  <strong>Wait for bank confirmation.</strong> An official bank reversal leaves no room for duplicate
                  loss.
                </p>
              </div>
            </div>

            <div className="pt-2">
              <Button
                variant="secondary"
                block
                onClick={() => {
                  setReportAccount(counterparty ?? '')
                  setReporting(true)
                }}
              >
                Report scam account
              </Button>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={onClose} block>
                Keep my money safe
              </Button>

              {onContinueAnyway && (
                <Button
                  variant="ghost"
                  block
                  disabled={secondsLeft > 0}
                  onClick={onContinueAnyway}
                  className="text-xs font-semibold text-slate-600 dark:text-slate-400"
                >
                  {secondsLeft > 0 ? `I understand the risk (wait ${secondsLeft}s)` : 'I still want to continue'}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Help protect other users. Report the account or person who requested the return transfer.
            </p>

            <Card className="space-y-3 bg-slate-50 dark:bg-slate-800 dark:border-slate-700">
              <Input
                label="Sender / Account identifier"
                value={reportAccount}
                onChange={(e) => setReportAccount(e.target.value)}
                placeholder="Account number or name"
              />

              <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                <span>Bank</span>
                <select
                  value={reportBank}
                  onChange={(e) => setReportBank(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-teal-600 focus:outline-hidden focus:ring-1 focus:ring-teal-600"
                >
                  <option value="access">Access Bank</option>
                  <option value="gtbank">GTBank</option>
                  <option value="zenith">Zenith Bank</option>
                  <option value="uba">UBA</option>
                  <option value="other">Other bank</option>
                </select>
              </label>

              <Input
                label="Evidence or narration reference"
                value={reportEvidence}
                onChange={(e) => setReportEvidence(e.target.value)}
                placeholder="e.g. TXN reference, phone number, chat log"
                hint="Required to verify the scam report."
              />
            </Card>

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" onClick={() => setReporting(false)} className="flex-1">
                Back
              </Button>
              <Button onClick={handleReport} loading={submitting} className="flex-1">
                Submit report
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
