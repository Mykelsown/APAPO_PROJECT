import { Skeleton } from './ui'

/** Shown while a route's code is still loading. */
export function PageFallback() {
  return (
    <div className="space-y-4 pt-2" aria-busy="true" aria-label="Loading page">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
