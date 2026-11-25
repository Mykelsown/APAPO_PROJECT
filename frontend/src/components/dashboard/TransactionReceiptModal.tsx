import { useState } from 'react'
import type { FeedRow } from '../../api/types'
import { formatKobo } from '../../lib/money'
import { Badge, Button, useToast } from '../ui'

interface Props {
  row: FeedRow | null
  open: boolean
  onClose: () => void
}

export function TransactionReceiptModal({ row, open, onClose }: Props) {
  if (!open || !row) return null
  return <ReceiptDialog row={row} onClose={onClose} />
}

function ReceiptDialog({ row, onClose }: { row: FeedRow; onClose: () => void }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const isIncoming = row.direction === 'incoming'
  const isInternal = Boolean(
    row.is_internal ||
    (row.counterparty?.startsWith('Split-Receive to') && !row.counterparty?.includes('Fatima') && !row.counterparty?.includes('Beneficiary')) ||
    row.counterparty?.startsWith('Split-Receive from')
  )

  const [reference] = useState(() => {
    const raw = row.id ?? `${row.bank_name}-${row.created_at ?? 'settled'}`
    return `NIP-${raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase()}`
  })
  const formattedDate = row.created_at
    ? new Date(row.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Recent Transaction'

  const receiptSummary = [
    '*APAPO TRANSACTION RECEIPT*',
    `Reference: ${reference}`,
    `Date: ${formattedDate}`,
    `Bank: ${row.bank_name}`,
    `Counterparty: ${row.counterparty ?? row.category}`,
    `Type: ${isInternal ? 'Internal Transfer' : isIncoming ? 'Credit / Inflow' : 'Debit / Outflow'}`,
    `Category: ${row.category}`,
    `Amount: ${isIncoming ? '+' : '-'}${formatKobo(row.amount_kobo)}`,
    `Status: ${row.verification === 'unverified' ? 'UNVERIFIED CREDIT (Pending Investigation)' : 'SETTLED & VERIFIED'}`,
    '_Orchestrated securely via Apapo Multi-Bank Platform_',
  ].join('\n')

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(receiptSummary)
      setCopied(true)
      toast.show('Receipt details copied to clipboard.', 'success')
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast.show('Could not copy automatically. You can copy the reference below.', 'error')
    }
  }

  function handleDownloadCSV() {
    const csvContent = [
      'Reference,Date,Bank,Counterparty,Type,Category,Amount Kobo,Formatted Amount,Status',
      `"${reference}","${formattedDate}","${row.bank_name}","${row.counterparty ?? row.category}","${isInternal ? 'Internal' : isIncoming ? 'Inflow' : 'Outflow'}","${row.category}",${row.amount_kobo},"${formatKobo(row.amount_kobo)}","${row.verification ?? 'verified'}"`
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `receipt-${reference}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.show('Receipt CSV downloaded.', 'success')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900 p-4 sm:items-center"
    >
      <div className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950/60 font-bold text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60 text-xs">
              A
            </span>
            <div>
              <h2 id="receipt-modal-title" className="text-sm font-bold text-slate-900 dark:text-white">
                Transaction receipt
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Official NIP settlement proof
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close receipt"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Amount & Status Hero */}
        <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-center space-y-1.5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {isInternal ? 'Internal Transfer Amount' : isIncoming ? 'Total Inflow' : 'Total Outflow'}
          </p>
          <p
            className={`text-2xl sm:text-3xl font-bold tracking-tight tabular-nums ${
              isInternal
                ? 'text-purple-700 dark:text-purple-300'
                : isIncoming
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {isIncoming ? '+' : '-'}
            {formatKobo(row.amount_kobo)}
          </p>
          <div className="pt-1 flex items-center justify-center gap-2">
            {row.verification === 'unverified' ? (
              <Badge tone="amber">Unverified Credit (Investigating)</Badge>
            ) : (
              <Badge tone="green">Settled & Confirmed</Badge>
            )}
            {isInternal && (
              <span className="inline-flex items-center rounded-full bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/60 px-2.5 py-0.5 text-xs font-semibold text-purple-800 dark:text-purple-300">
                Internal Reallocation
              </span>
            )}
          </div>
        </div>

        {/* Breakdown Key-Value Table */}
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <span className="font-medium text-slate-500 dark:text-slate-400">Reference ID</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-slate-900 dark:text-white">{reference}</span>
              <button
                type="button"
                onClick={handleCopy}
                className="text-teal-600 hover:text-teal-700 dark:text-teal-400 font-semibold text-[11px]"
                title="Copy reference"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <span className="font-medium text-slate-500 dark:text-slate-400">Account / Bank</span>
            <span className="font-bold text-slate-900 dark:text-white">{row.bank_name}</span>
          </div>

          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <span className="font-medium text-slate-500 dark:text-slate-400">Counterparty</span>
            <span className="font-semibold text-slate-900 dark:text-white">{row.counterparty ?? 'Self'}</span>
          </div>

          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <span className="font-medium text-slate-500 dark:text-slate-400">Category</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">{row.category}</span>
          </div>

          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <span className="font-medium text-slate-500 dark:text-slate-400">Timestamp</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">{formattedDate}</span>
          </div>

          {isInternal && (
            <p className="rounded-xl bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-900 p-2.5 text-[11px] text-purple-900 dark:text-purple-300 leading-relaxed font-medium">
              This is an internal transfer between your own linked accounts. It redistributed funds across your banks with a net ₦0 change to your combined balance pool.
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={handleDownloadCSV} className="flex-1 text-xs font-bold">
            <svg className="size-3.5 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download CSV
          </Button>

          <Button variant="secondary" onClick={handleCopy} className="flex-1 text-xs font-bold">
            <svg className="size-3.5 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
            </svg>
            {copied ? 'Copied' : 'Share Receipt'}
          </Button>

          <Button variant="primary" onClick={onClose} className="px-5 text-xs font-bold">
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
