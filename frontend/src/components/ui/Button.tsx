import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const styles: Record<Variant, string> = {
  primary:
    'bg-teal-700 hover:bg-teal-800 text-white font-bold active:translate-y-0.5 disabled:bg-slate-300 dark:bg-teal-700 dark:hover:bg-teal-600 dark:disabled:bg-slate-800 transition-colors',
  secondary:
    'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 active:translate-y-0.5 disabled:text-slate-400 dark:disabled:text-slate-600 transition-colors',
  danger:
    'bg-red-600 hover:bg-red-700 text-white font-bold active:translate-y-0.5 disabled:bg-slate-300 dark:bg-red-700 dark:hover:bg-red-600 dark:disabled:bg-slate-800 transition-colors',
  ghost:
    'text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950 font-semibold active:translate-y-0.5 disabled:text-slate-400 dark:disabled:text-slate-600 transition-colors',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
  block?: boolean
}

export function Button({ variant = 'primary', loading, block, className, disabled, children, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
        styles[variant],
        block && 'w-full',
        className,
      )}
    >
      {loading && (
        <span aria-hidden className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  )
}
