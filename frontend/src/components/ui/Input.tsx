import { useId, type InputHTMLAttributes } from 'react'
import { cx } from './cx'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

export function Input({ label, error, hint, className, id, ...rest }: Props) {
  const auto = useId()
  const inputId = id ?? auto
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'min-h-11 w-full rounded-xl bg-white dark:bg-slate-900 px-3.5 text-base text-slate-900 dark:text-white ring-1 transition-all focus:outline-hidden focus:ring-2 placeholder:text-slate-500 dark:placeholder:text-slate-400',
          error ? 'ring-red-500 focus:ring-red-500' : 'ring-slate-300 dark:ring-slate-700 focus:ring-teal-600 focus:border-transparent',
          className,
        )}
      />
      {error ? (
        <p id={`${inputId}-err`} role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-sm text-slate-600 dark:text-slate-400 font-medium">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
