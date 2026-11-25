import { useState } from 'react'
import type { PreviewLeg, PreviewResponse } from '../../api/types'
import { ScamShieldModal } from '../../components/safesend/ScamShieldModal'
import { Button, Card, RiskBadge } from '../../components/ui'
import { formatKobo } from '../../lib/money'

interface Props {
  preview: PreviewResponse
  recipient: string
  onBack: () => void
  onContinue: (updatedPreview?: PreviewResponse) => void
}

function calculateNipFee(amountKobo: number): number {
  if (amountKobo <= 0) return 0
  if (amountKobo <= 500_000) return 1_000 // N10 for <= N5,000
  if (amountKobo <= 5_000_000) return 2_500 // N25 for <= N50,000
  return 5_000 // N50 for > N50,000
}

export function PreviewStep({ preview, recipient, onBack, onContinue }: Props) {
  const [ackDuplicate, setAckDuplicate] = useState(false)
  const [ackRisk, setAckRisk] = useState(false)
  const [showShield, setShowShield] = useState(false)
  const [isWaterfall, setIsWaterfall] = useState(false)
  const [legs, setLegs] = useState<PreviewLeg[]>(() => preview.legs.map((l) => ({ ...l })))

  const high = preview.risk_tier === 'high'
  const unknown = preview.risk_tier === 'unknown'
  const targetTotal = preview.total_amount_kobo

  const currentTotal = legs.reduce((s, l) => s + l.amount_kobo, 0)
  const currentFee = legs.reduce((s, l) => s + l.fee_kobo, 0)
  const isBalanced = currentTotal === targetTotal
  const blocked = (preview.duplicate_warning && !ackDuplicate) || (high && !ackRisk) || !isBalanced
  const grand = currentTotal + currentFee

  function handleSlider(index: number, newKobo: number) {
    if (legs.length === 2) {
      const otherIndex = index === 0 ? 1 : 0
      const clampedNew = Math.max(0, Math.min(targetTotal, newKobo))
      const complementary = Math.max(0, targetTotal - clampedNew)

      setLegs((prev) => {
        const next = [...prev]
        next[index] = {
          ...next[index],
          amount_kobo: clampedNew,
          fee_kobo: calculateNipFee(clampedNew),
        }
        next[otherIndex] = {
          ...next[otherIndex],
          amount_kobo: complementary,
          fee_kobo: calculateNipFee(complementary),
        }
        return next
      })
    } else {
      setLegs((prev) =>
        prev.map((l, i) =>
          i === index
            ? {
                ...l,
                amount_kobo: newKobo,
                fee_kobo: calculateNipFee(newKobo),
              }
            : l,
        ),
      )
    }
  }

  function handleResetAuto() {
    setLegs(preview.legs.map((l) => ({ ...l })))
    setIsWaterfall(false)
  }

  function handleProceed() {
    if (blocked) return
    const updated: PreviewResponse = {
      ...preview,
      legs,
      total_amount_kobo: currentTotal,
      total_fee_kobo: currentFee,
    }
    onContinue(updated)
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-600 dark:text-slate-400">To {recipient}</p>
          <RiskBadge tier={preview.risk_tier} />
        </div>
        {preview.reasons && preview.reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
            {preview.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{formatKobo(preview.total_amount_kobo)}</p>
      </Card>

      {unknown && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-600 dark:text-slate-300">
          <p className="font-semibold text-slate-800 dark:text-slate-200">Unverified beneficiary</p>
          <p className="mt-0.5">
            This account has not established a transaction history on the Apapo network. Ensure you recognize this
            recipient before paying.
          </p>
        </div>
      )}

      {high && (
        <div role="alert" className="space-y-2 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/60 p-3.5 text-sm text-red-950 dark:text-red-200">
          <p className="font-bold text-red-900 dark:text-red-400">High Risk Recipient Detected</p>
          <p className="text-xs text-red-800 dark:text-red-300">
            This account has been flagged by multiple users for fraudulent behavior. Apapo strongly advises cancelling
            this payment.
          </p>
          <label className="flex items-start gap-2.5 pt-1 text-xs font-semibold text-red-900 dark:text-red-300 cursor-pointer">
            <input
              type="checkbox"
              checked={ackRisk}
              onChange={(e) => setAckRisk(e.target.checked)}
              className="mt-0.5 size-4 rounded-sm border-red-300 dark:border-red-700 text-red-600 focus:ring-red-500"
            />
            <span>I understand the confirmed fraud reports and assume personal liability for this transfer.</span>
          </label>
        </div>
      )}

      {/* MULTI-BANK SOURCE ACCOUNTS & WATERFALL */}
      <Card className="space-y-4 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Paid from {legs.length} {legs.length === 1 ? 'account' : 'accounts'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">
              {isWaterfall ? 'Custom tactile allocation' : 'Automated multi-bank optimization'}
            </p>
          </div>
          {legs.length > 1 && (
            <button
              type="button"
              onClick={() => setIsWaterfall(!isWaterfall)}
              className="text-xs font-bold text-teal-700 dark:text-teal-400 hover:underline flex items-center gap-1"
            >
              <span>{isWaterfall ? 'Reset to Auto' : 'Adjust Waterfall'}</span>
            </button>
          )}
        </div>

        {/* Dynamic Proportion Bar */}
        {legs.length > 1 && (
          <div className="space-y-1.5">
            <div
              role="img"
              aria-label={legs
                .map((l) => `${l.bank_name} ${Math.round((l.amount_kobo / targetTotal) * 100)} percent`)
                .join(',')}
              className="flex h-3.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 p-0.5"
            >
              {legs.map((l, i) => {
                const pct = targetTotal > 0 ? (l.amount_kobo / targetTotal) * 100 : 0
                return (
                  <div
                    key={l.account_id}
                    style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                    className={[
                      'bg-teal-600',
                      'bg-blue-600',
                      'bg-amber-500',
                      'bg-purple-600',
                    ][i % 4]}
                  />
                )
              })}
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Target: {formatKobo(targetTotal)}</span>
              <span
                className={`font-semibold ${
                  isBalanced
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {isBalanced
                  ? 'Balanced (100%)'
                  : currentTotal < targetTotal
                  ? `Short: ${formatKobo(targetTotal - currentTotal)}`
                  : `Over: ${formatKobo(currentTotal - targetTotal)}`}
              </span>
            </div>
          </div>
        )}

        {/* Account Legs / Interactive Waterfall Sliders */}
        <div className="space-y-3">
          {legs.map((l, idx) => (
            <div
              key={l.account_id}
              className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-3 space-y-2"
            >
              <div className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{l.bank_name}</p>
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Est. NIP Rail Fee: {formatKobo(l.fee_kobo)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold tabular-nums text-slate-900 dark:text-white">{formatKobo(l.amount_kobo)}</p>
                  {targetTotal > 0 && (
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      {Math.round((l.amount_kobo / targetTotal) * 100)}% of total
                    </span>
                  )}
                </div>
              </div>

              {isWaterfall && legs.length > 1 && (
                <div className="pt-1">
                  <input
                    type="range"
                    min={0}
                    max={targetTotal}
                    step={100_000}
                    value={l.amount_kobo}
                    onChange={(e) => handleSlider(idx, Number(e.target.value))}
                    className="w-full accent-teal-700 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg cursor-pointer"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* NIP Fee Optimization Notice */}
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-2.5 text-xs text-slate-700 dark:text-slate-300 font-medium flex items-center justify-between">
          <span>Tier-1 CBN NIP fees applied per leg</span>
          {isWaterfall && (
            <button
              type="button"
              onClick={handleResetAuto}
              className="text-xs font-bold text-teal-700 dark:text-teal-400 hover:underline"
            >
              Reset to Auto
            </button>
          )}
        </div>

        <dl className="space-y-1 border-t border-slate-100 dark:border-slate-800 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="font-medium text-slate-700 dark:text-slate-300">Principal Amount</dt>
            <dd className="tabular-nums text-slate-900 dark:text-white font-semibold">{formatKobo(currentTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-medium text-slate-700 dark:text-slate-300">Network Fees</dt>
            <dd className="tabular-nums text-slate-900 dark:text-white font-semibold">{formatKobo(currentFee)}</dd>
          </div>
          <div className="flex justify-between font-bold text-slate-900 dark:text-white">
            <dt>Total Debited</dt>
            <dd className="tabular-nums">{formatKobo(grand)}</dd>
          </div>
        </dl>
      </Card>

      {preview.shield_warning && (
        <div role="alert" className="flex items-center justify-between rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/60 p-3 text-sm text-amber-900 dark:text-amber-200">
          <div className="min-w-0 pr-2">
            <p className="font-semibold">Wrong-transfer alert</p>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Matches a recent unverified deposit. Check before returning funds.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setShowShield(true)}
            className="shrink-0 text-xs font-bold text-amber-900 dark:text-amber-200"
          >
            View advice
          </Button>
        </div>
      )}

      {preview.duplicate_warning && (
        <div role="alert" className="space-y-1 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/60 p-3 text-sm text-amber-950 dark:text-amber-200">
          <p className="font-semibold">Possible duplicate transfer</p>
          <p className="text-xs text-amber-800 dark:text-amber-300">
            You sent this exact amount to this recipient within the last 10 minutes.
          </p>
          <label className="flex items-start gap-2.5 pt-1 text-xs font-semibold text-amber-900 dark:text-amber-200 cursor-pointer">
            <input
              type="checkbox"
              checked={ackDuplicate}
              onChange={(e) => setAckDuplicate(e.target.checked)}
              className="mt-0.5 size-4 rounded-sm border-amber-300 text-amber-600 focus:ring-amber-500"
            />
            <span>This is an intentional second payment, not a duplicate tap.</span>
          </label>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button onClick={handleProceed} disabled={blocked} className="flex-[2]">
          Confirm with PIN
        </Button>
      </div>

      <ScamShieldModal
        open={showShield}
        amountKobo={preview.total_amount_kobo}
        counterparty={recipient}
        onClose={() => setShowShield(false)}
        onContinueAnyway={() => setShowShield(false)}
      />
    </div>
  )
}
