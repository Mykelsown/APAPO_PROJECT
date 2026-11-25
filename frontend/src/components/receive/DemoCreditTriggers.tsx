import { Button, Card } from '../ui'

interface Props {
  disabled: boolean
  onSimulate: (verified: boolean, amountKobo: number) => void
}

/** Demo-only buttons that make money "arrive" so Split-Receive can be shown without real funds. */
export function DemoCreditTriggers({ disabled, onSimulate }: Props) {
  return (
    <Card className="space-y-2 border-teal-200 dark:border-teal-800/60 bg-teal-50 dark:bg-teal-950/40 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs sm:text-sm font-bold text-teal-900 dark:text-teal-200">Demo Credit Triggers</span>
        <span className="text-[11px] text-teal-700 dark:text-teal-400 font-medium">Simulate incoming deposits without real money</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => onSimulate(true, 10_000_000)}
          className="h-8 px-3 text-xs text-teal-800 dark:text-teal-200"
        >
          + ₦100,000 Confirmed Deposit
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => onSimulate(true, 5_000_000)}
          className="h-8 px-3 text-xs text-teal-800 dark:text-teal-200"
        >
          + ₦50,000 Confirmed Deposit
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => onSimulate(false, 8_000_000)}
          className="h-8 px-3 text-xs text-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60"
        >
          + ₦80,000 Unverified (Ignored)
        </Button>
      </div>
    </Card>
  )
}
