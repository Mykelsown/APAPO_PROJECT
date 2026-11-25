import type { ApiError } from '../api/errors'
import { Button, Card } from './ui'

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <Card role="alert" className="space-y-3 text-center">
      <p className="font-medium text-slate-900 dark:text-white">
        {error.code === 'UNAUTHORIZED' ? 'Your session has ended' : 'Something went wrong'}
      </p>
      <p className="text-sm text-slate-700 dark:text-slate-300 font-medium">{error.message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Card>
  )
}
