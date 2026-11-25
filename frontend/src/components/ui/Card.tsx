import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cx(
        'rounded-2xl bg-white p-5 ring-1 ring-slate-200 transition-colors duration-200 dark:bg-slate-900 dark:ring-slate-800 dark:text-slate-100',
        className,
      )}
    />
  )
}
