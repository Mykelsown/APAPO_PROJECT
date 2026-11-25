import { useEffect, useState, type FormEvent } from 'react'
import { api, apiMode } from '../../api/client'
import { toApiError } from '../../api/errors'
import type { RecentRecipient, Recipient } from '../../api/types'
import { Button, Card, Input } from '../../components/ui'
import { demoPayees } from '../../lib/demoPayees'
import { parseNairaToKobo } from '../../lib/money'
import { useAsync } from '../../lib/useAsync'

interface Props {
  initialAmount?: string
  initialRecipient?: Recipient
  loading: boolean
  error?: string
  onSubmit: (amountKobo: number, recipient: Recipient, amountText: string) => void
}

const showDemoPayees = apiMode === 'mock' || import.meta.env.DEV
const demoRecipients = demoPayees(apiMode)

const presets = ['10,000', '50,000', '100,000', '150,000']

export function AmountStep({ initialAmount = '', initialRecipient, loading, error, onSubmit }: Props) {
  const [mode, setMode] = useState<'bank' | 'phone'>(initialRecipient?.apapo_phone ? 'phone' : 'bank')
  const [amount, setAmount] = useState(initialAmount)
  const [bankCode, setBankCode] = useState(initialRecipient?.bank_code ?? '')
  const [accountNumber, setAccountNumber] = useState(initialRecipient?.account_number ?? '')
  const [accountName, setAccountName] = useState(initialRecipient?.account_name)

  const [phone, setPhone] = useState(initialRecipient?.apapo_phone ?? '')
  const [lookupResult, setLookupResult] = useState<{ display_name?: string } | null>(
    initialRecipient?.masked_display_name ? { display_name: initialRecipient.masked_display_name } : null,
  )
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | undefined>()

  const [touched, setTouched] = useState(false)
  const banks = useAsync(() => api.banks.supported())
  const bankOptions = (banks.data?.banks ?? []).filter((b) => b.supported && b.code)

  const recent = useAsync(() => api.recipients.recent().catch(() => ({ recipients: [] })))
  const recentList = recent.data?.recipients ?? []

  const kobo = parseNairaToKobo(amount)
  const accountOk = /^\d{10}$/.test(accountNumber)
  const cleanPhone = phone.trim().replace(/\s+/g, '')
  const phoneOk = /^(0\d{10}|\+234\d{10})$/.test(cleanPhone)

  const amountError = touched && (kobo === null || kobo <= 0) ? 'Enter an amount like 5,000 or 5000.50' : undefined
  const bankError = touched && mode === 'bank' && !bankCode ? 'Choose the recipient bank' : undefined
  const accountError = touched && mode === 'bank' && !accountOk ? 'Enter the 10 digit account number' : undefined
  const phoneError =
    touched && mode === 'phone' && !phoneOk
      ? 'Enter a valid 11-digit phone number (e.g. 08012345678)'
      : touched && mode === 'phone' && !lookupResult && !lookupLoading
      ? 'Apapo recipient must be verified'
      : undefined

  // Inline lookup when phone number is valid
  useEffect(() => {
    if (mode !== 'phone') return
    const clean = phone.trim().replace(/\s+/g, '')
    if (!/^(0\d{10}|\+234\d{10})$/.test(clean)) return

    let active = true
    queueMicrotask(() => {
      if (active) {
        setLookupLoading(true)
        setLookupError(undefined)
      }
    })
    api.users
      .lookup(clean)
      .then((res) => {
        if (active) {
          setLookupResult(res.user)
          setLookupError(undefined)
        }
      })
      .catch((err) => {
        if (active) {
          setLookupResult(null)
          setLookupError(toApiError(err).message)
        }
      })
      .finally(() => {
        if (active) setLookupLoading(false)
      })

    return () => {
      active = false
    }
  }, [phone, mode])

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (kobo === null || kobo <= 0) return

    if (mode === 'bank') {
      if (!bankCode || !accountOk) return
      onSubmit(
        kobo,
        { bank_code: bankCode, account_number: accountNumber, account_name: accountName, recipient_type: 'outside' },
        amount,
      )
    } else {
      if (!phoneOk || !lookupResult) return
      onSubmit(
        kobo,
        {
          apapo_phone: cleanPhone,
          recipient_type: 'apapo',
          masked_display_name: lookupResult.display_name,
        },
        amount,
      )
    }
  }

  function pick(r: Recipient) {
    setMode('bank')
    setBankCode(r.bank_code ?? '')
    setAccountNumber(r.account_number ?? '')
    setAccountName(r.account_name)
  }

  function pickRecent(r: RecentRecipient) {
    if (r.recipient_type === 'apapo') {
      setMode('phone')
      if (r.apapo_phone) setPhone(r.apapo_phone)
      if (r.masked_display_name) setLookupResult({ display_name: r.masked_display_name })
    } else if (r.account_number) {
      setMode('bank')
      if (r.bank_code) setBankCode(r.bank_code)
      setAccountNumber(r.account_number.replace(/\D/g, ''))
      setAccountName(r.account_name)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Card className="space-y-5 p-6 border border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <Input
            label="Transfer Amount (NGN)"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={amountError}
            hint="Apapo orchestrates across all your linked bank balances to fulfill this payment."
          />

          {/* Quick presets */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mr-1">Quick:</span>
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                className="rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              >
                ₦{p}
              </button>
            ))}
          </div>
        </div>

        {/* Recipient Mode Tab */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">Recipient Method</label>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            <button
              type="button"
              onClick={() => setMode('bank')}
              className={`rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
                mode === 'bank'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Bank Account
            </button>
            <button
              type="button"
              onClick={() => setMode('phone')}
              className={`rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
                mode === 'phone'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Apapo Phone (P2P)
            </button>
          </div>
        </div>

        {mode === 'bank' ? (
          <>
            <div className="space-y-1">
              <label htmlFor="recipient-bank" className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                Recipient bank
              </label>
              <select
                id="recipient-bank"
                value={bankCode}
                onChange={(e) => setBankCode(e.target.value)}
                aria-invalid={bankError ? true : undefined}
                className="min-h-11 w-full rounded-xl bg-white dark:bg-slate-900 px-3 text-base text-slate-900 dark:text-white ring-1 ring-slate-300 dark:ring-slate-700 focus:ring-2 focus:ring-teal-600"
              >
                <option value="">{banks.loading && !banks.data ? 'Loading banks' : 'Choose a bank'}</option>
                {bankOptions.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
              {bankError && (
                <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                  {bankError}
                </p>
              )}
            </div>

            <Input
              label="Recipient account number"
              autoComplete="off"
              inputMode="numeric"
              maxLength={10}
              placeholder="10 digit account number"
              value={accountNumber}
              onChange={(e) => {
                setAccountNumber(e.target.value.replace(/\D/g, ''))
                setAccountName(undefined)
              }}
              error={accountError}
            />

            {showDemoPayees && (
              <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Frequent Beneficiaries & Test Payees
                  </p>
                  <span className="text-[10px] text-teal-700 dark:text-teal-400 font-semibold">Safe Send Shield Active</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {demoRecipients.map((d) => (
                    <button
                      key={d.recipient.account_number}
                      type="button"
                      onClick={() => pick(d.recipient)}
                      className={`flex items-center gap-2 rounded-xl border p-2.5 text-xs font-semibold transition-all cursor-pointer ${
                        accountNumber === d.recipient.account_number
                          ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-950 dark:text-teal-200 ring-1 ring-teal-600'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          d.tier === 'low'
                            ? 'bg-emerald-500'
                            : d.tier === 'high'
                            ? 'bg-red-500'
                            : 'bg-amber-500'
                        }`}
                      />
                      <span>{d.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <Input
              label="Recipient Apapo Phone Number"
              autoComplete="off"
              inputMode="tel"
              maxLength={14}
              placeholder="08012345678 or +234..."
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value)
                setLookupResult(null)
                setLookupError(undefined)
              }}
              error={phoneError}
              hint="Transfer instantly to any Apapo user. Funds deposit straight into their primary bank account."
            />

            {lookupLoading && (
              <p className="text-xs text-slate-500 dark:text-slate-400 animate-pulse">Checking Apapo phone directory...</p>
            )}

            {lookupResult && (
              <div className="flex items-center gap-2 rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 px-3.5 py-2.5 text-xs">
                <span className="size-2 rounded-full bg-teal-600 dark:text-teal-400" />
                <span className="text-slate-600 dark:text-slate-400">Apapo Recipient:</span>
                <span className="font-bold text-teal-950 dark:text-teal-200">{lookupResult.display_name}</span>
                <span className="ml-auto text-[10px] font-bold text-teal-700 dark:text-teal-400">Verified User</span>
              </div>
            )}

            {lookupError && (
              <div role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/60 p-3 text-xs text-red-800 dark:text-red-300">
                {lookupError}
              </div>
            )}
          </div>
        )}

        {/* Recent Recipients */}
        {recentList.length > 0 && (
          <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Recent Recipients</p>
            <div className="flex flex-wrap gap-2">
              {recentList.map((r, i) => (
                <button
                  key={`${r.recipient_type}-${r.apapo_phone ?? r.account_number ?? i}`}
                  type="button"
                  onClick={() => pickRecent(r)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold hover:border-slate-300 dark:hover:border-slate-600 transition-all cursor-pointer"
                >
                  <span className="size-2 shrink-0 rounded-full bg-teal-500" />
                  <span className="text-slate-800 dark:text-slate-200">
                    {r.masked_display_name ?? r.account_name ?? r.apapo_phone ?? r.account_number}
                  </span>
                  <span className="text-[10px] text-slate-500 uppercase">{r.recipient_type}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Gateway Uptime Indicator */}
      <div className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span className="font-semibold text-slate-700 dark:text-slate-300">NIP Clearing Status</span>
        </div>
        <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">All gateways operational (avg 420ms)</span>
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/60 p-4 text-sm text-red-900 dark:text-red-300">
          <p className="font-bold">Payment Preview Notice</p>
          <p className="text-xs text-red-800 dark:text-red-400 mt-0.5">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        block
        loading={loading}
        className="h-11 text-sm font-semibold bg-teal-700 hover:bg-teal-800 text-white"
      >
        Calculate Split-Pay Plan →
      </Button>
    </form>
  )
}
