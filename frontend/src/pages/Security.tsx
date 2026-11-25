import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { toApiError } from '../api/errors'
import type { AuditEntry, Limits, Session } from '../api/types'
import { Badge, Button, Card, Input, Skeleton, useToast } from '../components/ui'
import { useAuth } from '../context/useAuth'
import { formatKobo, parseNairaToKobo } from '../lib/money'
import { timeAgo } from '../lib/time'
import { useAsync } from '../lib/useAsync'

export function Security() {
  const nav = useNavigate()
  const toast = useToast()
  const { logout } = useAuth()

  const { data, loading, reload } = useAsync(async () => {
    const [limitsRes, sessionsRes, auditRes, meRes] = await Promise.all([
      api.security.getLimits(),
      api.security.sessions(),
      api.security.audit(),
      api.me.get().catch(() => null),
    ])
    return {
      limits: limitsRes,
      sessions: sessionsRes,
      audit: auditRes,
      me: meRes,
    }
  })

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Limit edit state
  const [editingLimits, setEditingLimits] = useState(false)
  const [dailyNaira, setDailyNaira] = useState('500,000')
  const [savingLimits, setSavingLimits] = useState(false)
  const [limitPin, setLimitPin] = useState('')

  // Logout all modal
  const [showLogoutAll, setShowLogoutAll] = useState(false)
  const [loggingOutAll, setLoggingOutAll] = useState(false)

  // Audit filter
  const [auditLimit, setAuditLimit] = useState(5)

  if (loading && !data) {
    return (
      <div className="space-y-4 pt-2" aria-busy="true" aria-label="Loading security settings">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const limits: Limits = data?.limits ?? { daily_limit_kobo: 50_000_000 }
  const sessions: Session[] = data?.sessions ?? []
  const auditEntries: AuditEntry[] = data?.audit ?? []

  async function handleSaveProfile() {
    if (!displayName.trim()) {
      toast.show('Please enter a display name.', 'error')
      return
    }
    setSavingProfile(true)
    try {
      await api.me.updateProfile({ display_name: displayName.trim() })
      toast.show('Display name updated.', 'success')
      setEditingProfile(false)
      await reload()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleSaveLimits() {
    const dailyKobo = parseNairaToKobo(dailyNaira)
    const minKobo = limits.min_limit_kobo ?? 100_000
    const maxKobo = limits.max_limit_kobo ?? 1_000_000_000
    if (!dailyKobo || dailyKobo < minKobo || dailyKobo > maxKobo) {
      toast.show(`Daily limit must be between ${formatKobo(minKobo)} and ${formatKobo(maxKobo)}.`, 'error')
      return
    }
    if (limitPin.length < 4) {
      toast.show('Enter your security PIN to save limits.', 'error')
      return
    }

    setSavingLimits(true)
    try {
      await api.security.setLimits({ daily_limit_kobo: dailyKobo }, limitPin)
      toast.show('Transfer limits updated.', 'success')
      setEditingLimits(false)
      setLimitPin('')
      await reload()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setSavingLimits(false)
    }
  }

  async function handleLogoutAll() {
    setLoggingOutAll(true)
    try {
      await api.security.logoutAll()
      toast.show('All active sessions terminated.', 'info')
      setShowLogoutAll(false)
      nav('/onboarding', { replace: true })
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setLoggingOutAll(false)
    }
  }

  async function handleSignOutCurrent() {
    await logout()
    toast.show('Signed out.', 'info')
    nav('/onboarding', { replace: true })
  }

  function getActionLabel(action: string) {
    switch (action) {
      case 'consent_granted':
        return 'Open banking consent granted'
      case 'account_linked':
        return 'Bank account connected'
      case 'account_revoked':
        return 'Bank account access revoked'
      case 'payment_completed':
        return 'Split-Pay payment completed'
      case 'report_submitted':
      case 'scam_report_submitted':
        return 'Fraud/scam report filed'
      case 'split_receive_rules_updated':
      case 'splitreceive.rules_set':
        return 'Split-Receive rules updated'
      case 'bank.linked':
        return 'Bank account connected'
      case 'bank.revoked':
        return 'Bank account access revoked'
      case 'payment.created':
        return 'Split-Pay payment started'
      case 'payment.state':
        return 'Split-Pay payment updated'
      case 'security.limit_changed':
        return 'Daily limit changed'
      case 'security.logout_all':
        return 'Signed out of all devices'
      case 'splitreceive.detected':
        return 'Incoming credit detected'
      case 'splitreceive.leg_sent':
        return 'Split-Receive share sent'
      case 'splitreceive.leg_failed':
        return 'Split-Receive share failed'
      case 'splitreceive.state':
        return 'Split-Receive run updated'
      case 'splitreceive.consent_revoked':
        return 'Split-Receive consent revoked'
      default:
        return action.replace(/[._]/g, '')
    }
  }

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Security & Privacy</h1>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium">Spending limits, active sessions, and immutable audit trail</p>
      </div>

      <div className="space-y-6 lg:grid lg:grid-cols-12 lg:gap-8 lg:space-y-0 lg:items-start">
        {/* Left Column: Profile, Limits & Consent */}
        <div className="space-y-6 lg:col-span-6">
          {/* USER PROFILE */}
          <Card className="space-y-3 dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Profile & Identity</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Your Apapo handle and recipient verification</p>
              </div>
              {!editingProfile && (
                <button
                  type="button"
                  onClick={() => {
                    setDisplayName(data?.me?.display_name ?? data?.me?.user.display_name ?? '')
                    setEditingProfile(true)
                  }}
                  className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Edit profile
                </button>
              )}
            </div>

            {!editingProfile ? (
              <div className="space-y-2 pt-1">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3.5 border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Display Name</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      {data?.me?.display_name ?? data?.me?.user.display_name ?? 'Not set'}
                    </p>
                  </div>
                  <Badge tone="purple">P2P Name</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 border border-slate-100 dark:border-slate-700">
                    <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Apapo Phone</p>
                    <p className="text-xs font-mono font-bold text-slate-900 dark:text-white mt-0.5">
                      {data?.me?.user.phone ?? '08012345678'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 border border-slate-100 dark:border-slate-700 flex flex-col justify-between">
                    <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">BVN Status</p>
                    <div className="w-fit mt-0.5">
                      <Badge tone="green">
                        {data?.me?.user.bvn_verified ? 'Verified BVN' : 'BVN Linked'}
                      </Badge>
                    </div>
                  </div>
                </div>

                {data?.me?.receiving_account && (
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 border border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs">
                    <div>
                      <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Primary Receiving Account</p>
                      <p className="font-bold text-slate-900 dark:text-white">
                        {data.me.receiving_account.bank_name} ({data.me.receiving_account.masked_number})
                      </p>
                    </div>
                    <Link to="/banks" className="text-xs font-bold text-teal-700 dark:text-teal-400 hover:underline">
                      Manage →
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-brand-200 dark:border-brand-900 bg-brand-50/20 dark:bg-slate-800 p-3.5">
                <Input
                  label="Display Name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Bola A."
                  hint="Visible to other Apapo users when they send money to your phone number."
                />
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="secondary"
                    onClick={() => setEditingProfile(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveProfile}
                    loading={savingProfile}
                    className="flex-1"
                  >
                    Save Changes
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* TRANSFER LIMITS */}
          <Card className="space-y-3 dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Transfer Limits</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Your daily transfer limit</p>
              </div>
              {!editingLimits && (
                <button
                  type="button"
                  onClick={() => {
                    setDailyNaira((limits.daily_limit_kobo / 100).toLocaleString())
                    setEditingLimits(true)
                  }}
                  className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Edit limits
                </button>
              )}
            </div>

            {!editingLimits ? (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3.5 border border-slate-100 dark:border-slate-700">
                  <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Daily Limit</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatKobo(limits.daily_limit_kobo)}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">Resets at midnight Lagos time</p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3.5 border border-slate-100 dark:border-slate-700">
                  <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Left today</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatKobo(limits.remaining_kobo ?? limits.daily_limit_kobo)}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    {formatKobo(limits.spent_today_kobo ?? 0)} spent today
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-brand-200 dark:border-brand-900 bg-brand-50/20 dark:bg-slate-800 p-3.5">
                <Input
                  label="Daily Limit (₦)"
                  value={dailyNaira}
                  onChange={(e) => setDailyNaira(e.target.value)}
                  placeholder="e.g. 500,000"
                />
                <Input
                  label="Confirm with PIN"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={limitPin}
                  onChange={(e) => setLimitPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="Security PIN"
                />
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditingLimits(false)
                      setLimitPin('')
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSaveLimits} loading={savingLimits} className="flex-1">
                    Save Limits
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* LINKED BANKS SHORTCUT */}
          <Card className="flex items-center justify-between p-4 dark:bg-slate-900 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Open Banking Consent</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Review permissions and revoke connected banks</p>
            </div>
            <Link
              to="/banks"
              className="rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              Manage
            </Link>
          </Card>

          {/* PRIVACY & SECURITY POLICY NOTE */}
          <Card className="space-y-2 border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4 text-xs text-slate-600 dark:text-slate-400">
            <h3 className="font-bold text-slate-800 dark:text-slate-200">Bank-Grade Cryptographic Security</h3>
            <p>
              Apapo never stores your online banking passwords or debit card PINs. All authorizations use Open Banking
              Nigeria tokenized OAuth consent with zero persistence of sensitive secrets.
            </p>
          </Card>

          {/* SIGN OUT BUTTON */}
          <div className="pt-1">
            <Button variant="secondary" onClick={handleSignOutCurrent} block className="text-xs font-semibold text-red-600 dark:text-red-400 ring-red-200 dark:ring-red-900 hover:bg-red-50 dark:hover:bg-red-950">
              Sign out of this device
            </Button>
          </div>
        </div>

        {/* Right Column: Sessions & Audit Trail */}
        <div className="space-y-6 lg:col-span-6">
          {/* ACTIVE SESSIONS */}
          <Card className="space-y-3 dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Active Sessions</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Devices signed into your Apapo account</p>
              </div>
              <button
                type="button"
                onClick={() => setShowLogoutAll(true)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              >
                Log out everywhere
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">{s.device ?? 'Signed-in session'}</p>
                    <p className="font-medium text-slate-600 dark:text-slate-400">
                      {s.created_at
                        ? timeAgo(s.created_at)
                        : s.expires_at
                          ? `Expires ${new Date(s.expires_at).toLocaleDateString()}`
                          : ''}
                    </p>
                  </div>
                  {s.current ? (
                    <Badge tone="green">Current Device</Badge>
                  ) : (
                    <Badge tone="blue">Authorized</Badge>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* AUDIT LOG TIMELINE */}
          <Card className="space-y-3 dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Audit Trail</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Immutable record of security and transfer actions</p>
              </div>
              <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                {auditEntries.length} events
              </span>
            </div>

            <div className="space-y-3">
              {auditEntries.slice(0, auditLimit).map((entry, idx) => (
                <div key={idx} className="flex gap-3 text-xs">
                  <div className="mt-1 flex size-2 shrink-0 rounded-full bg-teal-600" />
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{getActionLabel(entry.action)}</span>
                      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">{timeAgo(entry.timestamp)}</span>
                    </div>
                    <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">Resource: {entry.resource}</p>
                    {entry.details && <p className="text-[11px] text-slate-600 dark:text-slate-300">{entry.details}</p>}
                  </div>
                </div>
              ))}
            </div>

            {auditEntries.length > auditLimit && (
              <Button
                variant="ghost"
                block
                onClick={() => setAuditLimit((n) => n + 10)}
                className="h-8 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:text-teal-900"
              >
                Show older events
              </Button>
            )}
          </Card>
        </div>
      </div>

      {/* LOG OUT EVERYWHERE MODAL */}
      {showLogoutAll && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/80 p-4 sm:items-center"
        >
          <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 p-5 border border-slate-200 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Sign out of all devices?</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              This will invalidate every active session token. You will need to sign in again with your phone number and
              security PIN.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowLogoutAll(false)} className="flex-1">
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={loggingOutAll}
                onClick={handleLogoutAll}
                className="flex-1"
              >
                Sign Out All
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
