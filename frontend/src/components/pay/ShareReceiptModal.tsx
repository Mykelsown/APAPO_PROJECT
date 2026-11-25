import { useState } from 'react'
import type { PaymentStatus, PreviewResponse } from '../../api/types'
import { formatKobo } from '../../lib/money'
import { Button, useToast } from '../ui'

interface Props {
  open: boolean
  status: PaymentStatus
  preview: PreviewResponse
  recipient: string
  onClose: () => void
}

export function ShareReceiptModal(props: Props) {
  return props.open ? <ShareReceiptBody {...props} /> : null
}

function ShareReceiptBody({ status, preview, recipient, onClose }: Props) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  // Stamped once when the receipt opens, so re-renders do not change the time.
  const [now] = useState(() => new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }))

  const totalCharged = preview.total_amount_kobo + preview.total_fee_kobo

  const receiptText = `*APAPO TRANSFER RECEIPT*
Reference: ${status.payment_id}
Date: ${now}
Status: Successful

Recipient: ${recipient}
Total Amount: ${formatKobo(preview.total_amount_kobo)}
Network Fees: ${formatKobo(preview.total_fee_kobo)}
Total Charged: ${formatKobo(totalCharged)}

*Multi-Account Breakdown:*
${status.legs.map((l) => `- ${l.bank_name ?? l.account_id}: ${formatKobo(l.amount_kobo)}`).join('\n')}

_Orchestrated securely via Apapo Multi-Bank Infrastructure_`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(receiptText)
      setCopied(true)
      toast.show('Receipt copied to clipboard for WhatsApp or SMS.', 'success')
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast.show('Could not copy automatically. You can copy the text below.', 'error')
    }
  }

  function handlePrint() {
    window.print()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/80 p-4 sm:items-center"
    >
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 dark:border dark:border-slate-800 p-5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-teal-700 dark:text-teal-400">Apapo</span>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Transaction receipt</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Close
          </button>
        </div>

        {/* RECEIPT CARD */}
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
          <div className="border-b border-dashed border-slate-300 dark:border-slate-800 pb-2 text-center">
            <p className="text-sm font-bold text-slate-900 dark:text-white">Official payment proof</p>
            <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Ref: {status.payment_id}</p>
            <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">{now}</p>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400 font-medium">Recipient:</span>
              <span className="font-semibold text-slate-900 dark:text-white">{recipient}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400 font-medium">Total Sent:</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatKobo(preview.total_amount_kobo)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400 font-medium">Service Fees:</span>
              <span className="font-semibold">{formatKobo(preview.total_fee_kobo)}</span>
            </div>
          </div>

          <div className="border-t border-dashed border-slate-300 dark:border-slate-800 pt-2">
            <p className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">Source accounts debited</p>
            <div className="mt-1 space-y-1">
              {status.legs.map((l) => (
                <div key={l.account_id} className="flex justify-between text-[11px]">
                  <span>{l.bank_name ?? l.account_id}</span>
                  <span className="font-semibold">{formatKobo(l.amount_kobo)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-300 dark:border-slate-800 pt-2 text-center text-[11px] font-semibold text-slate-600 dark:text-slate-400">
            Status: Confirmed and settled
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <Button onClick={handleCopy} block className="text-xs font-bold">
            {copied ? 'Copied to clipboard' : 'Copy receipt for WhatsApp'}
          </Button>
          <Button variant="secondary" onClick={handlePrint} block className="text-xs">
            Print or save as PDF
          </Button>
        </div>
      </div>
    </div>
  )
}
