import { useState } from 'react'
import { api } from '../../api/client'
import { toApiError } from '../../api/errors'
import type { FeedRow } from '../../api/types'
import { Button, Card, useToast } from '../ui'

interface Props {
  open: boolean
  row: FeedRow | null
  onClose: () => void
  onSuccess: () => void
}

const CATEGORIES = [
  'Transport',
  'Food & Dining',
  'Bills',
  'Shopping',
  'Transfer',
  'Airtime & Data',
  'Income',
  'Other',
]

export function CategoryOverrideModal({ open, row, onClose, onSuccess }: Props) {
  const toast = useToast()
  const [selected, setSelected] = useState(row?.category ?? 'Other')
  const [saving, setSaving] = useState(false)

  if (!open || !row) return null

  const merchant = row.counterparty || row.category

  async function handleSave() {
    setSaving(true)
    try {
      await api.dashboard.overrideCategory({
        merchant,
        category: selected,
      })
      toast.show(`All transactions from "${merchant}" updated to ${selected}.`, 'success')
      onSuccess()
      onClose()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 p-4"
    >
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white dark:bg-slate-900 dark:border dark:border-slate-800 p-5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Change Category</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">For {merchant}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Close
          </button>
        </div>

        <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
          Pick a category for <strong>{merchant}</strong>. Apapo will automatically assign this category to all past
          and future transactions from this merchant.
        </p>

        <Card className="grid grid-cols-2 gap-2 p-2 dark:bg-slate-800 dark:border-slate-800">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelected(cat)}
              className={`rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors ${
                selected.toLowerCase() === cat.toLowerCase()
                  ? 'bg-teal-700 font-bold text-white'
                  : 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </Card>

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">
            Save Rule
          </Button>
        </div>
      </div>
    </div>
  )
}
