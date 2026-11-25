import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { cx } from './cx'
import { ToastContext, type ToastKind } from './useToast'

interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}
let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const show = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++seq
    setItems((cur) => [...cur, { id, kind, text }])
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 4500)
  }, [])

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))]"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto w-full max-w-sm rounded-xl px-4 py-3 text-sm font-semibold text-white dark:ring-1 dark:ring-white/10',
              t.kind === 'error' ? 'bg-red-700' : t.kind === 'success' ? 'bg-teal-700' : 'bg-slate-800',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
