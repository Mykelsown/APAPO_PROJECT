import { useState, type FormEvent } from 'react'
import { Button, Card, Input } from '../../components/ui'
import { formatKobo } from '../../lib/money'

interface Props {
  total: number
  loading: boolean
  error?: string
  onBack: () => void
  onConfirm: (pin: string) => void
}

function shuffleDigits(): number[] {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].sort(() => Math.random() - 0.5)
}

export function PinStep({ total, loading, error, onBack, onConfirm }: Props) {
  const [pin, setPin] = useState('')
  const [useKeypad, setUseKeypad] = useState(true)
  const [keypadDigits, setKeypadDigits] = useState<number[]>(() => shuffleDigits())
  const [copiedUssd, setCopiedUssd] = useState(false)

  const valid = /^\d{4,6}$/.test(pin)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (valid) onConfirm(pin)
  }

  function handleDigit(digit: number) {
    if (pin.length < 6) {
      setPin((prev) => prev + digit)
    }
  }

  function handleBackspace() {
    setPin((prev) => prev.slice(0, -1))
  }

  function handleClear() {
    setPin('')
  }

  function handleReshuffle() {
    setKeypadDigits(shuffleDigits())
  }

  const ussdCode = `*901*0*${Math.abs(Math.round(total / 100)) % 10000}#`

  async function copyUssd() {
    try {
      await navigator.clipboard.writeText(ussdCode)
      setCopiedUssd(true)
      setTimeout(() => setCopiedUssd(false), 2500)
    } catch {
      // Ignore clipboard write failure
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card className="space-y-4 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Security Authorization</h2>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Total to authorize: <span className="font-bold text-slate-900 dark:text-white">{formatKobo(total)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUseKeypad(!useKeypad)}
            className="text-xs font-bold text-teal-700 dark:text-teal-400 hover:underline"
          >
            {useKeypad ? 'Use Keyboard' : 'Use Scrambled Pad'}
          </button>
        </div>

        {useKeypad ? (
          <div className="space-y-4">
            {/* PIN Dots Indicator */}
            <div className="flex flex-col items-center justify-center space-y-2 py-1">
              <div className="flex items-center gap-3">
                {[0, 1, 2, 3].map((idx) => {
                  const filled = pin.length > idx
                  return (
                    <div
                      key={idx}
                      className={`size-4 rounded-full transition-all duration-200 ${
                        filled
                          ? 'scale-110 bg-teal-700 dark:bg-teal-500 ring-2 ring-teal-500'
                          : 'border-2 border-slate-300 dark:border-slate-700 bg-transparent'
                      }`}
                    />
                  )
                })}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-700 dark:text-slate-300 font-semibold">
                  Anti-shoulder surfing keypad
                </span>
                <button
                  type="button"
                  onClick={handleReshuffle}
                  className="text-[11px] font-bold text-teal-700 dark:text-teal-400 hover:underline"
                >
                  (Shuffle)
                </button>
              </div>
            </div>

            {/* Scrambled Number Pad */}
            <div className="mx-auto max-w-xs grid grid-cols-3 gap-2">
              {keypadDigits.slice(0, 9).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleDigit(d)}
                  className="h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-lg font-bold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition-all"
                >
                  {d}
                </button>
              ))}

              <button
                type="button"
                onClick={handleClear}
                className="h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() => handleDigit(keypadDigits[9])}
                className="h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-lg font-bold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition-all"
              >
                {keypadDigits[9]}
              </button>

              <button
                type="button"
                onClick={handleBackspace}
                className="h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                aria-label="Delete last digit"
              >
                ⌫
              </button>
            </div>
          </div>
        ) : (
          <Input
            label="Security PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoFocus
            hint="Enter your 4 to 6 digit Apapo authorization PIN."
          />
        )}
      </Card>

      {/* Access Bank USSD Failover Pill */}
      <div className="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/60 p-3.5 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-300">
            <svg className="size-3.5 text-amber-700 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z" />
            </svg>
            <span>Unstable Internet or Data Drop?</span>
          </div>
          <button
            type="button"
            onClick={copyUssd}
            className="text-xs font-bold text-amber-800 dark:text-amber-400 hover:underline"
          >
            {copiedUssd ? 'Copied' : 'Copy code'}
          </button>
        </div>
        <p className="text-xs text-amber-800 dark:text-amber-400 leading-relaxed">
          Access Bank USSD Failover: Dial <code className="font-mono font-bold">{ussdCode}</code> directly on your registered SIM to authorize offline.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/60 p-3 text-sm text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/60">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onBack} disabled={loading} className="flex-1">
          Back
        </Button>
        <Button type="submit" disabled={!valid} loading={loading} className="flex-[2]">
          {error ? 'Retry payment' : 'Pay now'}
        </Button>
      </div>
    </form>
  )
}
