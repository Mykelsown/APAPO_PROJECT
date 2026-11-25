import { cx } from './cx'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800', className)} />
}
