import { useState } from 'react'
import { api } from '../api/client'
import { toApiError } from '../api/errors'
import type { Account, BankLink, ConsentInfo, SupportedBank } from '../api/types'
import { Badge, Button, Card, Skeleton, useToast } from '../components/ui'
import { useBalancePrivacy } from '../context/useBalancePrivacy'
import { formatKobo } from '../lib/money'
import { useAsync } from '../lib/useAsync'

const bankStyles: Record<string, { dot: string; border: string; bg: string }> = {
  'Access Bank': { dot: 'bg-orange-500', border: 'border-l-orange-500', bg: 'bg-orange-500/5' },
  GTBank: { dot: 'bg-amber-500', border: 'border-l-amber-500', bg: 'bg-amber-500/5' },
  'Zenith Bank': { dot: 'bg-rose-500', border: 'border-l-rose-500', bg: 'bg-rose-500/5' },
  UBA: { dot: 'bg-red-500', border: 'border-l-red-500', bg: 'bg-red-500/5' },
  'Kuda Bank': { dot: 'bg-purple-500', border: 'border-l-purple-500', bg: 'bg-purple-500/5' },
  'First Bank': { dot: 'bg-blue-600', border: 'border-l-blue-600', bg: 'bg-blue-500/5' },
  Opay: { dot: 'bg-emerald-500', border: 'border-l-emerald-500', bg: 'bg-emerald-500/5' },
  'Apex Bank': { dot: 'bg-teal-600', border: 'border-l-teal-600', bg: 'bg-teal-500/5' },
  'Delta Trust Bank': { dot: 'bg-indigo-600', border: 'border-l-indigo-600', bg: 'bg-indigo-500/5' },
  'Savanna Bank': { dot: 'bg-amber-600', border: 'border-l-amber-600', bg: 'bg-amber-500/5' },
  'Harbor MFB': { dot: 'bg-cyan-600', border: 'border-l-cyan-600', bg: 'bg-cyan-500/5' },
}

export function Banks() {
  const { hideBalance } = useBalancePrivacy()
  const toast = useToast()
  const { data, loading, reload } = useAsync(async () => {
    const [supportedRes, accountsRes, linkedRes, meRes] = await Promise.all([
      api.banks.supported(),
      api.accounts.list(),
      api.banks.linked(),
      api.me.get().catch(() => null),
    ])
    return {
      supported: supportedRes.banks,
      consent: supportedRes.consent,
      accounts: accountsRes.accounts,
      links: linkedRes.links,
      me: meRes,
    }
  })

  const [linking, setLinking] = useState(false)
  const [selectedBank, setSelectedBank] = useState<string>('')
  const [consentGiven, setConsentGiven] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  // Revoke modal state
  const [revokingAccount, setRevokingAccount] = useState<Account | null>(null)
  const [revoking, setRevoking] = useState(false)

  if (loading && !data) {
    return (
      <div className="space-y-4 pt-2" aria-busy="true" aria-label="Loading banks">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  const supported: SupportedBank[] = data?.supported ?? []
  const accounts: Account[] = data?.accounts ?? []
  const links: BankLink[] = data?.links ?? []
  const consent: ConsentInfo | undefined = data?.consent
  const linkedNames = new Set(links.map((l) => l.bank_name))
  const consentDays = consent?.duration_days ?? 90
  const receivingAccountId = data?.me?.receiving_account?.account_id
  const linkFor = (bankName: string) => links.find((l) => l.bank_name === bankName)
  const daysLeft = (l: BankLink) => Math.max(0, Math.ceil((new Date(l.consent_expires_at).getTime() - now) / 86_400_000))

  async function handleLinkBank() {
    if (!selectedBank) {
      toast.show('Please choose a bank.', 'error')
      return
    }
    if (!consentGiven) {
      toast.show('You must accept the open banking consent terms.', 'error')
      return
    }

    setSubmitting(true)
    try {
      await api.banks.link({
        bank_name: selectedBank,
        consent: true,
      })
      toast.show(`${selectedBank} account linked successfully.`, 'success')
      setLinking(false)
      setSelectedBank('')
      setConsentGiven(false)
      await reload()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSetPrimary(account: Account) {
    setSettingPrimaryId(account.account_id)
    try {
      await api.me.setReceivingAccount(account.account_id)
      toast.show(`${account.bank_name} is now your primary receiving account.`, 'success')
      await reload()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setSettingPrimaryId(null)
    }
  }

  async function handleRevokeAccount() {
    if (!revokingAccount) return
    setRevoking(true)
    try {
      await api.banks.revoke(revokingAccount.account_id)
      toast.show(`Revoked access to ${revokingAccount.bank_name}.`, 'info')
      setRevokingAccount(null)
      await reload()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="space-y-6 pt-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Linked Accounts</h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium">Manage connected bank credentials and Open Banking consent</p>
        </div>
        {!linking && (
          <Button onClick={() => setLinking(true)} className="h-9 px-4 text-xs font-semibold self-start sm:self-auto">
            + Link bank
          </Button>
        )}
      </div>

      {/* LINK BANK FLOW */}
      {linking && (
        <Card className="mx-auto max-w-2xl space-y-4 border-brand-300 dark:border-slate-700 bg-brand-50 dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between border-b border-brand-100 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-brand-950 dark:text-white">Link a Bank Account</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Connect via Open Banking Nigeria consent rails</p>
            </div>
            <button
              type="button"
              onClick={() => setLinking(false)}
              className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Select Bank</label>
              {selectedBank ? (
                <span className="text-[11px] font-bold text-teal-700 dark:text-teal-400">Selected: {selectedBank}</span>
              ) : (
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Tap a bank marked Ready</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {supported.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  disabled={!b.supported || linkedNames.has(b.name)}
                  onClick={() => setSelectedBank(b.name)}
                  className={`flex flex-col justify-between rounded-xl border p-3 text-left text-xs transition-colors ${
                    selectedBank === b.name
                      ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 font-bold text-teal-950 dark:text-teal-200 ring-1 ring-teal-600'
                      : b.supported
                      ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
                      : 'cursor-not-allowed border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 opacity-60 text-slate-500 dark:text-slate-400 font-medium'
                  }`}
                >
                  <span className="truncate font-semibold">{b.name}</span>
                  {!b.supported ? (
                    <span className="mt-2 inline-block w-fit rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 dark:text-slate-300">
                      Soon
                    </span>
                  ) : linkedNames.has(b.name) ? (
                    <span className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 font-medium">Linked</span>
                  ) : (
                    <span className="mt-2 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Ready</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Open Banking Consent Terms */}
          <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 text-xs text-slate-700 dark:text-slate-300">
            <p className="font-bold text-slate-900 dark:text-white">Open Banking Consent Summary</p>
            <ul className="list-disc space-y-1 pl-4 text-slate-600 dark:text-slate-400">
              {(consent?.scopes ?? [
                { id: 'accounts', label: 'Your account names and masked numbers' },
                { id: 'balances', label: 'Your account balances' },
                { id: 'transactions', label: 'Your transaction history' },
              ]).map((s) => (
                <li key={s.id}>{s.label}</li>
              ))}
              <li>Consent is valid for {consentDays} days and can be revoked at any time.</li>
            </ul>
            <label className="flex items-start gap-2 pt-1 font-semibold text-slate-900 dark:text-white cursor-pointer">
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
                className="mt-0.5 size-4 rounded-sm border-slate-300 dark:border-slate-600 text-brand-600 focus:ring-brand-500"
              />
              <span>I grant Apapo permission to access my bank account data per the terms above.</span>
            </label>
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={() => setLinking(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleLinkBank} loading={submitting} disabled={!consentGiven || !selectedBank} className="flex-1">
              Authorize and Link
            </Button>
          </div>
        </Card>
      )}

      {/* LINKED ACCOUNTS LIST */}
      <div>
        {accounts.length === 0 ? (
          <Card className="py-12 text-center">
            <p className="text-base font-semibold text-slate-700 dark:text-slate-300">No linked bank accounts</p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 font-medium">Connect your accounts to enable Split-Pay and unified balances.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((acct) => {
              const bStyle = bankStyles[acct.bank_name] ?? {
                dot: 'bg-emerald-500',
                border: 'border-l-emerald-500',
                bg: 'bg-emerald-500/5',
              }
              const isPrimary = acct.account_id === receivingAccountId
              return (
                <Card
                  key={acct.account_id}
                  className={`flex flex-col justify-between p-5 space-y-4 transition-all border-l-4 ${bStyle.border} dark:bg-slate-900 dark:border-slate-800`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`size-2.5 rounded-full ${bStyle.dot}`} />
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{acct.bank_name}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isPrimary && <Badge tone="purple">Primary Receiving</Badge>}
                        <Badge tone="green">{linkFor(acct.bank_name) ? `${daysLeft(linkFor(acct.bank_name)!)} days left` : 'Active'}</Badge>
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-2.5 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Account</span>
                      <p className="text-xs text-slate-800 dark:text-slate-200 font-mono tracking-widest">{acct.masked_number}</p>
                    </div>

                    <div>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">Real-Time Balance</span>
                      <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">
                        {formatKobo(acct.balance_kobo, hideBalance)}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 dark:border-slate-800 pt-3 flex items-center justify-between">
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium flex items-center gap-1">
                      <svg className="size-3 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                      </svg>
                      Consent Active
                    </span>
                    <div className="flex items-center gap-2">
                      {!isPrimary && (
                        <Button
                          variant="secondary"
                          onClick={() => handleSetPrimary(acct)}
                          loading={settingPrimaryId === acct.account_id}
                          className="h-7 px-2.5 text-xs font-semibold"
                        >
                          Set as Receiving
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        onClick={() => setRevokingAccount(acct)}
                        className="h-7 px-3 text-xs font-semibold text-red-600 dark:text-red-400 ring-red-200 dark:ring-red-900 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* REVOKE CONFIRMATION MODAL */}
      {revokingAccount && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/80 dark:bg-black/80 p-4 sm:items-center"
        >
          <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Revoke {revokingAccount.bank_name} Access?
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              This will permanently delete stored credentials for {revokingAccount.masked_number}. Apapo will no
              longer be able to read this account or include it in Split-Pay plans.
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setRevokingAccount(null)}
                className="flex-1"
              >
                Keep Linked
              </Button>
              <Button
                variant="danger"
                loading={revoking}
                onClick={handleRevokeAccount}
                className="flex-1"
              >
                Confirm Revoke
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
