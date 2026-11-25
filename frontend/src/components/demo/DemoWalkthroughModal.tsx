import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui'

export function DemoWalkthroughModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [slide, setSlide] = useState(0)

  if (!open) return null

  const steps = [
    {
      title: '1. Multi-Bank Linking & Aggregation',
      summary:
        'Apapo connects directly across multiple commercial banks (Access, GTBank, Zenith, UBA). Total balance and transaction feeds aggregate seamlessly with open banking consent.',
      actionLink: '/banks',
      actionText: 'View Linked Banks',
    },
    {
      title: '2. "Why Did My Money Move" Card',
      summary:
        'Deterministic spending analysis calculates monthly shifts. The Insights card on the home screen explains shifts in plain language grounded by verified transaction evidence.',
      actionLink: '/',
      actionText: 'Go to Dashboard',
    },
    {
      title: '3. Split-Pay with Two-Phase Rollback',
      summary:
        'Pay an amount no single bank account covers (e.g. ₦150,000). If any leg fails, Apapo automatically rolls back earlier steps and restores your balances.',
      actionLink: '/pay',
      actionText: 'Try Split-Pay',
    },
    {
      title: '4. Safe Send & Scam Shield',
      summary:
        'Recipients undergo real-time fraud risk screening. The Scam Shield detects unverified deposits within 24 hours to prevent the classic return-transfer scam.',
      actionLink: '/',
      actionText: 'Inspect Safe Send',
    },
    {
      title: '5. Split-Receive & Settlement Ledger',
      summary:
        'Incoming confirmed credits are automatically split across target accounts according to user rules, backed by an immutable double-entry settlement ledger.',
      actionLink: '/receive',
      actionText: 'Open Split-Receive',
    },
  ]

  const cur = steps[slide]

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
          <span className="rounded-full bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/60 px-2.5 py-0.5 text-xs font-bold text-teal-900 dark:text-teal-300">
            Demo Script Step {slide + 1} of {steps.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
          >
            Close
          </button>
        </div>

        <div className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{cur.title}</h2>
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 font-medium">{cur.summary}</p>
        </div>

        <div className="flex items-center justify-between pt-2">
          <Link
            to={cur.actionLink}
            onClick={onClose}
            className="rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/60 px-3.5 py-2 text-xs font-bold text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 transition-colors"
          >
            {cur.actionText}
          </Link>

          <div className="flex gap-2">
            {slide > 0 && (
              <Button variant="secondary" onClick={() => setSlide((s) => s - 1)} className="h-9 px-3 text-xs">
                Back
              </Button>
            )}
            {slide < steps.length - 1 ? (
              <Button onClick={() => setSlide((s) => s + 1)} className="h-9 px-3 text-xs">
                Next
              </Button>
            ) : (
              <Button onClick={onClose} className="h-9 px-3 text-xs">
                Finish Tour
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
