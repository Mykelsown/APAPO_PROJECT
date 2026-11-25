import type { Api } from './client'
import { ApiError } from './errors'
import { session } from './session'
import type {
  Account,
  AuditEntry,
  AuthUser,
  BankLink,
  Dashboard,
  FeedRow,
  Limits,
  PaymentLeg,
  PaymentState,
  PreviewResponse,
  RiskTier,
  Session,
  Shift,
  SupportedBank,
  SupportedBanksResponse,
  DemoFailureRequest,
} from './types'

/**
 * Adapter between the app's domain types and the Go backend (docs/api-contract.md on the
 * backend branch). The UI and the mock use the domain shapes; everything that differs on
 * the wire is translated here and nowhere else.
 */

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

// ---- Wire types (only the fields we read) ----

interface WireError {
  error?: { code?: string; message?: string; details?: unknown }
}
interface WireTokens {
  access_token: string
  refresh_token: string
  user: AuthUser
}
interface WireAccount {
  id: string
  link_id: string
  bank_code: string
  bank_name: string
  account_name?: string
  account_number: string
  balance_kobo: number
}
interface WireLink {
  id: string
  bank_code: string
  scopes: string[]
  consent_at: string
  consent_expires_at: string
}
interface WireDashboard {
  total_balance_kobo: number
  banks: { bank_code: string; bank_name: string; balance_kobo?: number; unavailable: boolean; accounts?: WireAccount[] }[]
  feed: {
    items: {
      id: string
      bank_name: string
      direction: 'credit' | 'debit'
      amount_kobo: number
      counterparty?: string
      narration?: string
      category: string
      verification: 'confirmed' | 'unverified'
      posted_at: string
    }[]
  }
}
interface WireRisk {
  tier: RiskTier
  reasons: string[]
}
interface WirePayment {
  id: string
  state: PaymentState
  message: string
  legs: { account_id: string; bank_code: string; amount_kobo: number; fee_kobo: number; state: PaymentLeg['state'] }[]
}
interface WireShift {
  category: string
  direction: 'up' | 'down'
  change_pct: number
  current: { total_kobo: number; count: number; average_kobo: number; weekend_share_pct: number }
  previous: { total_kobo: number; count: number; average_kobo: number; weekend_share_pct: number }
  top_counterparties?: { name: string }[]
  supporting_transaction_ids?: string[]
  summary?: string
}

// ---- Vocabulary translation ----

const CATEGORY_LABEL: Record<string, string> = {
  transport: 'Transport',
  food: 'Food & Dining',
  airtime_data: 'Airtime & Data',
  bills: 'Bills',
  shopping: 'Shopping',
  transfer: 'Transfer',
  income: 'Income',
  other: 'Other',
}
const categoryLabel = (slug: string) => CATEGORY_LABEL[slug] ?? slug
const categorySlug = (label: string) =>
  Object.entries(CATEGORY_LABEL).find(([, v]) => v === label)?.[0] ?? label.toLowerCase().replace(/[^a-z]+/g, '_')

const REASON_TEXT: Record<string, string> = {
  reported_by_multiple_people: 'Reported by several people',
  some_reports_not_enough_to_confirm: 'Some reports, not enough to confirm',
  name_does_not_match_bank_record: 'The name does not match the bank record',
  first_payment_to_this_recipient: 'First payment to this recipient',
  amount_far_above_your_usual_payments: 'Far above your usual payments',
  same_payment_sent_minutes_ago: 'Same payment sent a few minutes ago',
  no_reports_and_no_warning_signs: 'No reports and no warning signs',
}
const reasonText = (code: string) =>
  REASON_TEXT[code] ?? code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

// ---- Transport ----

const NETWORK_ERROR = {
  code: 'NETWORK_ERROR',
  message: 'We could not reach Apapo. Check your connection and try again.',
}

function toError(status: number, body: WireError | null): ApiError {
  const e = body?.error
  if (!e?.code) return new ApiError({ code: 'HTTP_ERROR', message: `Request failed (${status}).` }, status)
  // The app checks UNAUTHORIZED; the backend uses unauthorized and invalid_token for the same thing.
  const code = e.code === 'invalid_token' ? 'UNAUTHORIZED' : e.code.toUpperCase()
  return new ApiError({ code, message: e.message ?? 'Something went wrong.', details: e.details }, status)
}

interface Opts {
  body?: unknown
  headers?: Record<string, string>
  /** Auth calls never trigger a refresh (login with a bad PIN is a 401 too). */
  noRefresh?: boolean
}

let refreshing: Promise<boolean> | null = null

/** One refresh at a time. The old refresh token dies on use, so concurrent calls must share it. */
function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    const refresh_token = session.getRefresh()
    if (!refresh_token) return false
    try {
      const res = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token }),
      })
      if (!res.ok) return false
      const t = (await res.json()) as { access_token: string; refresh_token: string }
      session.set(t.access_token)
      session.setRefresh(t.refresh_token)
      return true
    } catch {
      return false
    }
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

async function send(method: string, path: string, opts: Opts): Promise<Response> {
  const token = session.get()
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  } catch {
    throw new ApiError(NETWORK_ERROR)
  }
}

async function request<R>(method: string, path: string, opts: Opts = {}): Promise<R> {
  let res = await send(method, path, opts)
  if (res.status === 401 && !opts.noRefresh && session.getRefresh()) {
    const body = (await res.clone().json().catch(() => null)) as WireError | null
    if (body?.error?.code === 'invalid_token' && (await refreshTokens())) {
      res = await send(method, path, opts)
    }
  }
  if (!res.ok) throw toError(res.status, (await res.json().catch(() => null)) as WireError | null)
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as R
}

const get = <R>(p: string) => request<R>('GET', p)
const post = <R>(p: string, body?: unknown, o: Opts = {}) => request<R>('POST', p, { body: body ?? {}, ...o })
const put = <R>(p: string, body: unknown) => request<R>('PUT', p, { body })

// ---- Mappers ----

function storeTokens(t: WireTokens) {
  session.set(t.access_token)
  session.setRefresh(t.refresh_token)
  return { token: t.access_token, user_id: t.user.id, user: t.user }
}

let banksCache: Promise<SupportedBanksResponse> | null = null
function supportedBanks(): Promise<SupportedBanksResponse> {
  banksCache ??= get<{ banks: { code: string; name: string; supported: boolean }[]; consent: SupportedBanksResponse['consent'] }>(
    '/api/banks/supported',
  )
    .then((r) => ({
      consent: r.consent,
      banks: r.banks.map(
        (b): SupportedBank => ({
          code: b.code,
          name: b.name,
          supported: b.supported,
          flag: b.supported ? undefined : 'coming_soon',
        }),
      ),
    }))
    .catch((e) => {
      banksCache = null
      throw e
    })
  return banksCache
}
const bankName = async (code: string) => (await supportedBanks()).banks.find((b) => b.code === code)?.name ?? code

const toAccount = (a: WireAccount): Account => ({
  account_id: a.id,
  bank_name: a.bank_name,
  masked_number: a.account_number,
  balance_kobo: a.balance_kobo,
  bank_code: a.bank_code,
  link_id: a.link_id,
  account_name: a.account_name,
})

interface WirePreview {
  flags?: string[]
  legs: { account_id: string; bank_name: string; amount_kobo: number; fee_kobo: number }[]
  amount_kobo: number
  total_fee_kobo: number
  risk: WireRisk
}

const toPreview = (r: WirePreview): PreviewResponse => ({
  risk_tier: r.risk.tier,
  reasons: r.risk.reasons.map(reasonText),
  legs: r.legs.map((l) => ({ account_id: l.account_id, bank_name: l.bank_name, amount_kobo: l.amount_kobo, fee_kobo: l.fee_kobo })),
  total_amount_kobo: r.amount_kobo,
  total_fee_kobo: r.total_fee_kobo,
  duplicate_warning: r.flags?.includes('possible_duplicate') ?? false,
  // Preview carries no shield result; the scam shield comes from GET /api/shield/check.
  shield_warning: false,
})

const toShift = (s: WireShift): Shift => ({
  category: categoryLabel(s.category),
  previous_total_kobo: s.previous.total_kobo,
  current_total_kobo: s.current.total_kobo,
  percent_change: s.direction === 'down' ? -s.change_pct : s.change_pct,
  transaction_count_prev: s.previous.count,
  transaction_count_curr: s.current.count,
  avg_amount_prev: s.previous.average_kobo,
  avg_amount_curr: s.current.average_kobo,
  weekend_share_prev: s.previous.weekend_share_pct,
  weekend_share_curr: s.current.weekend_share_pct,
  top_counterparties: (s.top_counterparties ?? []).map((c) => c.name),
  supporting_transaction_ids: s.supporting_transaction_ids ?? [],
  direction: s.direction,
  summary: s.summary,
})

function auditDetail(detail: unknown): string | undefined {
  if (!detail || typeof detail !== 'object') return undefined
  const parts = Object.entries(detail as Record<string, unknown>)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
  return parts.length ? parts.join(', ') : undefined
}

// ---- The adapter ----

export const realApi: Api = {
  auth: {
    sendOtp: async (phone) => {
      const r = await post<{ expires_in_seconds: number }>('/api/auth/otp', { phone }, { noRefresh: true })
      return { expires_at: new Date(Date.now() + r.expires_in_seconds * 1000).toISOString() }
    },
    verifyOtp: async (phone, code) =>
      storeTokens(await post<WireTokens>('/api/auth/verify-otp', { phone, code }, { noRefresh: true })),
    submitBvn: async (bvn) => {
      const r = await post<{ user: AuthUser }>('/api/auth/bvn', { bvn })
      return { verified: r.user.bvn_verified }
    },
    setPin: async ({ pin, confirm_pin }) => {
      if (pin !== confirm_pin) throw new ApiError({ code: 'PIN_MISMATCH', message: 'The two PINs do not match.' })
      await post('/api/auth/pin', { pin })
      return { status: 'set' }
    },
    login: async ({ phone, pin }) => storeTokens(await post<WireTokens>('/api/auth/login', { phone, pin }, { noRefresh: true })),
    logout: async () => {
      await post('/api/auth/logout', undefined, { noRefresh: true }).catch(() => undefined)
      return { status: 'logged_out' }
    },
    refresh: async () => {
      if (!(await refreshTokens())) throw new ApiError({ code: 'UNAUTHORIZED', message: 'Please sign in again.' }, 401)
      return { token: session.get() ?? '' }
    },
  },

  banks: {
    supported: () => supportedBanks(),
    link: async ({ bank_name, consent }) => {
      const info = await supportedBanks()
      const bank = info.banks.find((b) => b.name === bank_name)
      if (!bank?.code) throw new ApiError({ code: 'BANK_UNSUPPORTED', message: `${bank_name} is not available.` }, 422)
      const scopes = info.consent?.scopes.map((s) => s.id) ?? ['accounts', 'balances', 'transactions']
      const r = await post<{ accounts: WireAccount[] }>('/api/banks/link', {
        bank_code: bank.code,
        consent: { accepted: consent, scopes },
      })
      const first = r.accounts[0]
      return { account_id: first?.id ?? '', masked_number: first?.account_number ?? '' }
    },
    linked: async () => {
      const [{ links }, info] = await Promise.all([get<{ links: WireLink[] }>('/api/banks/linked'), supportedBanks()])
      return {
        links: links.map(
          (l): BankLink => ({
            id: l.id,
            bank_code: l.bank_code,
            bank_name: info.banks.find((b) => b.code === l.bank_code)?.name ?? l.bank_code,
            scopes: l.scopes,
            consent_at: l.consent_at,
            consent_expires_at: l.consent_expires_at,
          }),
        ),
      }
    },
    // The UI revokes by account; the backend revokes by link.
    revoke: async (accountId) => {
      const { accounts } = await get<{ accounts: WireAccount[] }>('/api/accounts')
      const acct = accounts.find((a) => a.id === accountId)
      if (!acct) throw new ApiError({ code: 'NOT_FOUND', message: 'That account is not linked.' }, 404)
      await request('DELETE', `/api/banks/${encodeURIComponent(acct.link_id)}`)
      return { status: 'revoked' }
    },
  },

  accounts: {
    list: async () => ({ accounts: (await get<{ accounts: WireAccount[] }>('/api/accounts')).accounts.map(toAccount) }),
  },

  dashboard: {
    get: async (): Promise<Dashboard> => {
      const d = await get<WireDashboard>('/api/dashboard?limit=100')
      return {
        total_balance_kobo: d.total_balance_kobo,
        bank_cards: d.banks.map((b) => ({ bank_name: b.bank_name, balance_kobo: b.balance_kobo ?? 0, unavailable: b.unavailable })),
        transaction_feed: d.feed.items.map(
          (t): FeedRow => ({
            id: t.id,
            bank_name: t.bank_name,
            amount_kobo: t.direction === 'debit' ? -t.amount_kobo : t.amount_kobo,
            direction: t.direction === 'debit' ? 'outgoing' : 'incoming',
            category: categoryLabel(t.category),
            verification: t.verification,
            counterparty: t.counterparty || t.narration,
            created_at: t.posted_at,
          }),
        ),
      }
    },
    overrideCategory: async ({ merchant, category }) => {
      await put('/api/categories/override', { merchant, category: categorySlug(category) })
      return { status: 'updated' }
    },
  },

  splitPay: {
    preview: async (req) => {
      return toPreview(await post<WirePreview>('/api/splitpay/preview', req))
    },
    execute: async (req, key) => {
      const r = await post<WirePayment>('/api/splitpay/execute', req, { headers: { 'Idempotency-Key': key } })
      return { payment_id: r.id, status: r.state }
    },
    status: async (id) => {
      const r = await get<WirePayment & { reversal_attempt_count?: number; next_reversal_retry_at?: string; last_reversal_attempt_at?: string; human_review?: boolean }>(`/api/splitpay/${encodeURIComponent(id)}`)
      const legs = await Promise.all(
        r.legs.map(async (l): Promise<PaymentLeg> => ({
          account_id: l.account_id,
          bank_name: await bankName(l.bank_code),
          amount_kobo: l.amount_kobo,
          state: l.state,
        })),
      )
      return {
        payment_id: r.id,
        state: r.state,
        legs,
        message: r.message,
        reversal_attempt_count: r.reversal_attempt_count,
        next_reversal_retry_at: r.next_reversal_retry_at,
        last_reversal_attempt_at: r.last_reversal_attempt_at,
        human_review: r.human_review,
      }
    },
  },

  safeSend: {
    riskCheck: async (req) => {
      const r = await post<WireRisk & { flags?: string[] }>('/api/risk/check', req)
      return { risk_tier: r.tier, reasons: r.reasons.map(reasonText), flags: r.flags }
    },
    shieldCheck: (amount_kobo) =>
      get(amount_kobo ? `/api/shield/check?amount_kobo=${encodeURIComponent(amount_kobo)}` : '/api/shield/check'),
    shieldDismiss: (credit_id) => post('/api/shield/dismiss', { credit_id }),
    report: (req) => post('/api/reports', req),
  },

  splitReceive: {
    getRules: () => get('/api/splitreceive/rules'),
    setRules: (req) => put('/api/splitreceive/rules', req),
    disableRules: () => request('DELETE', '/api/splitreceive/rules'),
    scan: () => post('/api/splitreceive/scan'),
    runs: (limit = 50) => get(`/api/splitreceive/runs?limit=${limit}`),
    getRun: (id) => get(`/api/splitreceive/runs/${encodeURIComponent(id)}`),
    retryRun: (id) => post(`/api/splitreceive/runs/${encodeURIComponent(id)}/retry`),
    reconciliation: (from, to) => {
      const q = new URLSearchParams()
      if (from) q.set('from', from)
      if (to) q.set('to', to)
      const qs = q.toString()
      return get(`/api/reconciliation${qs ? `?${qs}` : ''}`)
    },
    simulateCredit: (req) => post('/api/demo/simulate-credit', req),
  },

  insights: {
    shifts: async () => ({ shifts: (await get<{ shifts: WireShift[] }>('/api/insights/shifts')).shifts.map(toShift) }),
  },

  security: {
    audit: async (): Promise<AuditEntry[]> => {
      const r = await get<{ entries: { event: string; subject_id: string; at: string; detail?: unknown }[] }>('/api/audit?limit=50')
      return r.entries.map((e) => ({ action: e.event, resource: e.subject_id, timestamp: e.at, details: auditDetail(e.detail) }))
    },
    getLimits: async (): Promise<Limits> => {
      const r = await get<{
        daily_limit_kobo: number
        spent_today_kobo: number
        remaining_kobo: number
        min_kobo: number
        max_kobo: number
      }>('/api/security/limits')
      return {
        daily_limit_kobo: r.daily_limit_kobo,
        spent_today_kobo: r.spent_today_kobo,
        remaining_kobo: r.remaining_kobo,
        min_limit_kobo: r.min_kobo,
        max_limit_kobo: r.max_kobo,
      }
    },
    setLimits: async ({ daily_limit_kobo }, pin) => {
      await put('/api/security/limits', { daily_limit_kobo, pin })
      return { status: 'updated' }
    },
    sessions: async (): Promise<Session[]> => {
      const r = await get<{ sessions: { id: string; current: boolean; expires_at: string }[] }>('/api/sessions')
      return r.sessions.map((s) => ({ id: s.id, current: s.current, expires_at: s.expires_at }))
    },
    logoutAll: async () => {
      await post('/api/sessions/logout-all', undefined, { noRefresh: true })
      return { status: 'logged_out' }
    },
  },

  users: {
    lookup: (phone: string) => get(`/api/users/lookup?phone=${encodeURIComponent(phone)}`),
  },

  me: {
    get: async () => {
      const r = await get<{
        user: AuthUser & { display_name?: string }
        onboarding: { bvn_verified: boolean; pin_set: boolean; complete: boolean }
        display_name?: string
        receiving_account?: WireAccount | null
      }>('/api/me')
      return {
        user: {
          id: r.user.id,
          phone: r.user.phone,
          display_name: r.display_name ?? r.user.display_name,
          bvn_verified: r.user.bvn_verified,
          pin_set: r.user.pin_set,
        },
        onboarding: r.onboarding,
        display_name: r.display_name ?? r.user.display_name,
        receiving_account: r.receiving_account ? toAccount(r.receiving_account) : null,
      }
    },
    updateProfile: (req) => put('/api/me/profile', req),
    setReceivingAccount: async (accountId: string) => {
      const r = await put<{ receiving_account: WireAccount }>('/api/me/receiving-account', { account_id: accountId })
      return { receiving_account: toAccount(r.receiving_account) }
    },
  },

  recipients: {
    recent: (limit = 20) => get(`/api/recipients/recent?limit=${limit}`),
  },

  demo: {
    setFailure: (req: DemoFailureRequest) => post('/api/demo/failure', req),
  },
}
