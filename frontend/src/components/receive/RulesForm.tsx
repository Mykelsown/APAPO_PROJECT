import type { RulesForm as RulesFormState } from './useRulesForm'
import { formatKobo } from '../../lib/money'
import { Button, Card, Input } from '../ui'

/** The three cards of the editor: receiving account, distribution targets, and the standing authorisation. */
export function RulesForm({ form }: { form: RulesFormState }) {
  const {
    accounts,
    rules,
    receivingId,
    setReceivingId,
    destinations,
    consent,
    setConsent,
    pin,
    setPin,
    saving,
    totalPercent,
    addDestination,
    removeDestination,
    updateDestination,
    applyPreset,
    saveRules,
    disableRules,
  } = form

  return (
    <div className="space-y-4 lg:col-span-7">
      <Card className="space-y-3 dark:bg-slate-900 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">1. Receiving Account</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Only credits that arrive into this primary account will be processed by Split-Receive.
        </p>
        <label className="block">
          <span className="sr-only">Receiving Account</span>
          <select
            value={receivingId}
            onChange={(e) => setReceivingId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-sm font-medium text-slate-900 dark:text-white focus:border-teal-500 focus:outline-hidden"
          >
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id} className="text-slate-900 dark:text-white">
                {a.bank_name} ({a.masked_number}) - Balance: {formatKobo(a.balance_kobo)}
              </option>
            ))}
          </select>
        </label>
      </Card>

      <Card className="space-y-3 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">2. Distribution Rules</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">What is not distributed stays in the receiving account.</p>
          </div>
          <Button variant="ghost" onClick={addDestination} className="h-8 text-xs font-semibold">
            + Add target
          </Button>
        </div>

        {/* Strategy Presets */}
        <div className="rounded-xl border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/20 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-teal-900 dark:text-teal-300">
              Rule Strategy Presets
            </span>
            <span className="text-[11px] text-teal-700 dark:text-teal-400 font-medium">Auto Presets</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => applyPreset('sme')}
              className="rounded-lg border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-800 dark:text-slate-200 hover:border-teal-500 hover:text-teal-700 dark:hover:text-teal-300 transition-colors cursor-pointer"
            >
              SME 60/30/10
            </button>
            <button
              type="button"
              onClick={() => applyPreset('family')}
              className="rounded-lg border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-800 dark:text-slate-200 hover:border-teal-500 hover:text-teal-700 dark:hover:text-teal-300 transition-colors cursor-pointer"
            >
              Family 75/25
            </button>
            <button
              type="button"
              onClick={() => applyPreset('wealth')}
              className="rounded-lg border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-800 dark:text-slate-200 hover:border-teal-500 hover:text-teal-700 dark:hover:text-teal-300 transition-colors cursor-pointer"
            >
              50/30/20 Plan
            </button>
          </div>
        </div>

        {destinations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 py-6 text-center text-xs text-slate-600 dark:text-slate-400">
            No split targets added yet. All incoming credits remain in the receiving account.
          </p>
        ) : (
          <div className="space-y-3">
            {destinations.map((d, index) => {
              const isPct = d.percent !== undefined
              return (
                <div key={index} className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 dark:text-white">Target #{index + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeDestination(index)}
                      className="font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {d.beneficiary ? (
                      <div className="rounded-lg bg-white dark:bg-slate-900 p-2 font-medium text-slate-900 dark:text-white ring-1 ring-slate-200 dark:ring-slate-700 truncate">
                        Outside: {d.beneficiary.account_name} ({d.beneficiary.bank_code})
                      </div>
                    ) : (
                      <select
                        value={d.account_id ?? ''}
                        onChange={(e) => updateDestination(index, { account_id: e.target.value })}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-xs text-slate-900 dark:text-white"
                      >
                        {accounts.map((a) => (
                          <option key={a.account_id} value={a.account_id} className="text-slate-900 dark:text-white">
                            {a.bank_name} ({a.masked_number})
                          </option>
                        ))}
                      </select>
                    )}

                    <div className="flex items-center gap-2">
                      <label className="flex-1">
                        <span className="sr-only">Value</span>
                        {isPct ? (
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={d.percent ?? 0}
                            onChange={(e) => {
                              const val = Math.max(0, Math.min(100, Number(e.target.value) || 0))
                              updateDestination(index, { percent: val, fixed_kobo: undefined })
                            }}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-500"
                            placeholder="% Share"
                          />
                        ) : (
                          <input
                            type="number"
                            min="0"
                            value={Math.round((d.fixed_kobo ?? 0) / 100)}
                            onChange={(e) => {
                              const val = Math.max(0, Math.round(Number(e.target.value) || 0))
                              updateDestination(index, {
                                fixed_kobo: val * 100,
                                percent: undefined,
                              })
                            }}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-500"
                            placeholder="Fixed Naira"
                          />
                        )}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          if (isPct) {
                            updateDestination(index, { percent: undefined, fixed_kobo: 500_000 })
                          } else {
                            updateDestination(index, { percent: 25, fixed_kobo: undefined })
                          }
                        }}
                        className="shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 px-2.5 py-2 font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600"
                      >
                        {isPct ? '%' : '₦'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {totalPercent > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2 text-xs">
            <span className="text-slate-700 dark:text-slate-300 font-medium">Total automated percentage:</span>
            <span className={`font-bold ${totalPercent > 100 ? 'text-red-600' : 'text-slate-900 dark:text-white'}`}>
              {totalPercent}% {totalPercent > 100 ? '(exceeds 100%)' : `(${100 - totalPercent}% stays)`}
            </span>
          </div>
        )}
      </Card>

      {/* CONFIRMATION & ACTIONS */}
      <Card className="space-y-3 dark:bg-slate-900 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">3. Standing Authorisation</h2>
        <label className="flex items-start gap-2.5 text-xs text-slate-800 dark:text-slate-200">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-4 rounded-sm border-slate-300 dark:border-slate-600 text-teal-700 focus:ring-teal-500"
          />
          <span>
            I authorize Apapo to automatically distribute incoming confirmed deposits according to these rules. I can
            disable this at any time.
          </span>
        </label>

        <Input
          label="Security PIN"
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="4 to 6 digit PIN"
          hint="Required to authorise automated money rules."
        />

        <div className="flex gap-2 pt-1">
          {rules?.active && (
            <Button variant="secondary" onClick={disableRules} disabled={saving} className="flex-1">
              Disable
            </Button>
          )}
          <Button onClick={saveRules} loading={saving} disabled={!consent} className="flex-1">
            Save and Activate
          </Button>
        </div>
      </Card>
    </div>
  )
}
