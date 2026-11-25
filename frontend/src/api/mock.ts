import { DEMO_NUMBERS } from '../lib/demoPayees'
import type { Api } from './client'
import { ApiError } from './errors'
import { session } from './session'
import { formatKobo } from '../lib/money'
import type {
  Account,
  AuditEntry,
  ExecuteRequest,
  FeedRow,
  PaymentLeg,
  PaymentState,
  PaymentStatus,
  PreviewLeg,
  Recipient,
  RiskTier,
  Session,
  Shift,
  SupportedBank,
  BankLink,
  SplitReceiveRules,
  SplitReceiveRun,
  SplitReceiveLeg,
  ReconciliationEntry,
} from './types'

/** Demo switches. Long pressing the Split-Pay title flips forceFailure. */
export const mockControls = {
  forceFailure: false,
  banksDown: new Set<string>(),
}

const LEG_FEE_KOBO = 5000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const lag = () => sleep(180 + Math.random() * 280)
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()

function fail(code: string, message: string, status = 400): never {
  throw new ApiError({ code, message }, status)
}

function requireAuth() {
  if (!session.get()) fail('UNAUTHORIZED', 'Please sign in again.', 401)
}

// ---- Seed state ----

let mockProfile = {
  display_name: 'Hayzed Idris',
  receiving_account_id: 'ACCT-001',
}

let accounts: Account[] = [
  { account_id: 'ACCT-001', bank_name: 'Access Bank', masked_number: '*****4821', balance_kobo: 7_000_000 },
  { account_id: 'ACCT-002', bank_name: 'GTBank', masked_number: '*****7340', balance_kobo: 6_000_000 },
  { account_id: 'ACCT-003', bank_name: 'Zenith Bank', masked_number: '*****1096', balance_kobo: 4_500_000 },
  { account_id: 'ACCT-004', bank_name: 'UBA', masked_number: '*****5513', balance_kobo: 2_000_000 },
]

const supportedBanks: SupportedBank[] = [
  { code: 'access', name: 'Access Bank', supported: true },
  { code: 'gtb', name: 'GTBank', supported: true },
  { code: 'zenith', name: 'Zenith Bank', supported: true },
  { code: 'uba', name: 'UBA', supported: true },
  { code: 'kuda', name: 'Kuda Bank', supported: true },
  { code: 'firstbank', name: 'First Bank', supported: true },
  { code: 'opay', name: 'Opay', supported: true },
  { code: 'fidelity', name: 'Fidelity Bank', supported: false, flag: 'coming_soon' },
]

const feed: FeedRow[] = [
  { id: 'TXN-001', bank_name: 'Access Bank', amount_kobo: 25_000_000, direction: 'incoming', category: 'Salary', verification: 'confirmed', counterparty: 'Northwind Ltd', created_at: iso(60 * 20) },
  { id: 'TXN-002', bank_name: 'GTBank', amount_kobo: 1_500_000, direction: 'incoming', category: 'Transfer', verification: 'unverified', counterparty: 'Chinedu O.', created_at: iso(12) },
  { id: 'TXN-003', bank_name: 'Access Bank', amount_kobo: -420_000, direction: 'outgoing', category: 'Food & Dining', verification: 'confirmed', counterparty: 'Mama Put Kitchen', created_at: iso(95) },
  { id: 'TXN-004', bank_name: 'Zenith Bank', amount_kobo: -1_250_000, direction: 'outgoing', category: 'Transport', verification: 'confirmed', counterparty: 'Bolt', created_at: iso(60 * 6) },
  { id: 'TXN-005', bank_name: 'UBA', amount_kobo: -310_000, direction: 'outgoing', category: 'Food & Dining', verification: 'confirmed', counterparty: 'Chicken Republic', created_at: iso(60 * 9) },
  { id: 'TXN-006', bank_name: 'GTBank', amount_kobo: -850_000, direction: 'outgoing', category: 'Bills', verification: 'confirmed', counterparty: 'IKEDC', created_at: iso(60 * 26) },
  { id: 'TXN-007', bank_name: 'Zenith Bank', amount_kobo: 600_000, direction: 'incoming', category: 'Transfer', verification: 'confirmed', counterparty: 'Amaka E.', created_at: iso(60 * 30) },
  { id: 'TXN-008', bank_name: 'Access Bank', amount_kobo: -2_100_000, direction: 'outgoing', category: 'Shopping', verification: 'confirmed', counterparty: 'Jumia', created_at: iso(60 * 50) },
  { id: 'TXN-009', bank_name: 'Access Bank', amount_kobo: -500_000, direction: 'outgoing', category: 'Airtime & Data', verification: 'confirmed', counterparty: 'MTN VTU', created_at: iso(60 * 70) },
  { id: 'TXN-010', bank_name: 'GTBank', amount_kobo: -1_800_000, direction: 'outgoing', category: 'Shopping', verification: 'confirmed', counterparty: 'Shoprite Lekki', created_at: iso(60 * 95) },
  { id: 'TXN-011', bank_name: 'Zenith Bank', amount_kobo: -350_000, direction: 'outgoing', category: 'Transport', verification: 'confirmed', counterparty: 'Uber Nigeria', created_at: iso(60 * 120) },
  { id: 'TXN-012', bank_name: 'UBA', amount_kobo: -450_000, direction: 'outgoing', category: 'Bills', verification: 'confirmed', counterparty: 'Netflix', created_at: iso(60 * 140) },
  { id: 'TXN-013', bank_name: 'Access Bank', amount_kobo: -750_000, direction: 'outgoing', category: 'Food & Dining', verification: 'confirmed', counterparty: 'Chowdeck', created_at: iso(60 * 160) },
  { id: 'TXN-014', bank_name: 'GTBank', amount_kobo: -250_000, direction: 'outgoing', category: 'Bills', verification: 'confirmed', counterparty: 'Spotify', created_at: iso(60 * 180) },
  { id: 'TXN-015', bank_name: 'Zenith Bank', amount_kobo: -1_100_000, direction: 'outgoing', category: 'Health', verification: 'confirmed', counterparty: 'Medplus Pharmacy', created_at: iso(60 * 200) },
  { id: 'TXN-016', bank_name: 'Access Bank', amount_kobo: 4_200_000, direction: 'incoming', category: 'Transfer', verification: 'confirmed', counterparty: 'Turing Remote', created_at: iso(60 * 240) },
  { id: 'TXN-017', bank_name: 'UBA', amount_kobo: -600_000, direction: 'outgoing', category: 'Transport', verification: 'confirmed', counterparty: 'Lagos BRT Cowry', created_at: iso(60 * 280) },
  { id: 'TXN-018', bank_name: 'Access Bank', amount_kobo: -950_000, direction: 'outgoing', category: 'Food & Dining', verification: 'confirmed', counterparty: 'The Place Lekki', created_at: iso(60 * 320) },
]

const shifts: Shift[] = [
  {
    category: 'Food & Dining',
    previous_total_kobo: 1_850_000,
    current_total_kobo: 1_240_000,
    percent_change: -33,
    transaction_count_prev: 14,
    transaction_count_curr: 9,
    avg_amount_prev: 132_143,
    avg_amount_curr: 137_778,
    weekend_share_prev: 55,
    weekend_share_curr: 32,
    top_counterparties: ['Mama Put Kitchen', 'Chicken Republic'],
    supporting_transaction_ids: ['TXN-003', 'TXN-005'],
  },
  {
    category: 'Transport',
    previous_total_kobo: 640_000,
    current_total_kobo: 1_250_000,
    percent_change: 95,
    transaction_count_prev: 5,
    transaction_count_curr: 8,
    avg_amount_prev: 128_000,
    avg_amount_curr: 156_250,
    weekend_share_prev: 20,
    weekend_share_curr: 41,
    top_counterparties: ['Bolt'],
    supporting_transaction_ids: ['TXN-004'],
  },
]

const LIMIT_MIN_KOBO = 100_000
const LIMIT_MAX_KOBO = 1_000_000_000
let dailyLimitKobo = 50_000_000

let sessions: Session[] = [
  { id: 'SES-001', device: 'This browser', created_at: iso(15), current: true },
  { id: 'SES-002', device: 'Android, Lagos', created_at: iso(60 * 40), current: false },
]

const audit: AuditEntry[] = [
  { action: 'consent_granted', resource: 'Access Bank', timestamp: iso(60 * 72), details: 'Read balances and transactions for 90 days' },
  { action: 'account_linked', resource: 'ACCT-001', timestamp: iso(60 * 72 - 2) },
  { action: 'account_linked', resource: 'ACCT-002', timestamp: iso(60 * 71) },
  { action: 'payment_completed', resource: 'PAY-0001', timestamp: iso(60 * 30), details: 'To Ada N., 3 legs' },
  { action: 'report_submitted', resource: 'REP-0001', timestamp: iso(60 * 5) },
]

// ---- Payments (state is derived from elapsed time so polling animates it) ----

interface MockPayment {
  id: string
  legs: PreviewLeg[]
  startedAt: number
  fails: boolean
  recipient?: string
}
const payments = new Map<string, MockPayment>()
const idempotency = new Map<string, string>()
const recentSends: { amount: number; at: number }[] = []
let paySeq = 1
let repSeq = 1
let otpIssued = '123456'
let srSeq = 2
const dismissedShields = new Set<string>()

let splitRules: SplitReceiveRules | null = {
  receiving_account_id: 'ACCT-001',
  destinations: [
    { account_id: 'ACCT-002', percent: 30 },
    {
      beneficiary: { bank_code: 'zenith', account_number: '1000000003', account_name: 'Fatima Bello (Feeding)' },
      percent: 40,
    },
  ],
  standing_consent_at: iso(60 * 24 * 5),
  active: true,
  note: 'Whatever is not sent stays in the receiving account.',
}

let splitRuns: SplitReceiveRun[] = [
  {
    id: 'SR-0001',
    credit_id: 'TXN-001',
    account_id: 'ACCT-001',
    amount_kobo: 25_000_000,
    received_at: iso(60 * 20),
    state: 'settled',
    message: 'Divided across destinations successfully.',
    legs: [
      {
        id: 'SR-0001-LEG-1',
        position: 1,
        destination: { account_id: 'ACCT-002', percent: 30 },
        amount_kobo: 7_500_000,
        fee_kobo: 2500,
        state: 'settled',
      },
      {
        id: 'SR-0001-LEG-2',
        position: 2,
        destination: {
          beneficiary: { bank_code: 'zenith', account_number: '1000000003', account_name: 'Fatima Bello' },
          fixed_kobo: 500_000,
        },
        amount_kobo: 500_000,
        fee_kobo: 2500,
        state: 'settled',
      },
    ],
    created_at: iso(60 * 20),
    updated_at: iso(60 * 20),
  },
]

const LEG_STEP_MS = 1000

function derivePayment(p: MockPayment): PaymentStatus {
  const elapsed = Date.now() - p.startedAt
  const n = p.legs.length
  const mk = (state: (i: number) => PaymentLeg['state']): PaymentLeg[] =>
    p.legs.map((l, i) => ({
      account_id: l.account_id,
      bank_name: l.bank_name,
      amount_kobo: l.amount_kobo,
      state: state(i),
      risk_tier: 'low',
    }))
  const collectedAt = (i: number) => (i + 1) * LEG_STEP_MS

  if (p.fails) {
    const failIdx = n - 1
    const failAt = collectedAt(failIdx)
    const reverseAt = failAt + LEG_STEP_MS
    if (elapsed >= reverseAt) {
      return {
        payment_id: p.id,
        state: 'rolled_back',
        legs: mk((i) => (i === failIdx ? 'failed' : 'reversed')),
        message: 'We reversed the earlier steps. Your money is back.',
      }
    }
    return {
      payment_id: p.id,
      state: 'collecting',
      legs: mk((i) => (i === failIdx ? (elapsed >= failAt ? 'failed' : 'pending') : elapsed >= collectedAt(i) ? 'collected' : 'pending')),
      message: elapsed >= failAt ? 'One account could not be charged. Reversing now.' : 'Collecting from your accounts.',
    }
  }

  const sendAt = collectedAt(n - 1)
  const doneAt = sendAt + LEG_STEP_MS * 1.5
  let state: PaymentState = 'collecting'
  if (elapsed >= doneAt) state = 'completed'
  else if (elapsed >= sendAt) state = 'sending'
  return {
    payment_id: p.id,
    state,
    legs: mk((i) => (elapsed >= collectedAt(i) ? 'collected' : 'pending')),
    message:
      state === 'completed' ? 'Payment sent.' : state === 'sending' ? 'Sending to the recipient.' : 'Collecting from your accounts.',
  }
}

// ---- Planner (greedy, largest balance first, matches "no single account covers it") ----

function plan(amountKobo: number, banks?: string[]): PreviewLeg[] {
  const pool = accounts
    .filter((a) => !mockControls.banksDown.has(a.bank_name))
    .filter((a) => !banks?.length || banks.includes(a.bank_name))
    .sort((a, b) => b.balance_kobo - a.balance_kobo)
  const legs: PreviewLeg[] = []
  let remaining = amountKobo
  for (const a of pool) {
    if (remaining <= 0) break
    const take = Math.min(a.balance_kobo, remaining)
    if (take > 0) legs.push({ account_id: a.account_id, bank_name: a.bank_name, amount_kobo: take, fee_kobo: LEG_FEE_KOBO })
    remaining -= take
  }
  if (remaining > 0) fail('INSUFFICIENT_FUNDS', 'Your linked accounts do not hold enough for this payment.', 422)
  return legs
}

function riskFor(recipient: Recipient): { tier: RiskTier; reasons: string[] } {
  if (recipient.account_number === DEMO_NUMBERS.high)
    return { tier: 'high', reasons: ['Reported by several people', 'Account opened 4 days ago'] }
  if (recipient.account_number === DEMO_NUMBERS.low) return { tier: 'low', reasons: ['No reports and no warning signs'] }
  return { tier: 'unknown', reasons: ['First payment to this recipient'] }
}

const startOfTodayWAT = (): number => {
  const now = new Date()
  const watDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return new Date(`${watDateStr}T00:00:00+01:00`).getTime()
}

const spentTodayKobo = () => {
  const start = startOfTodayWAT()
  return recentSends.filter((s) => s.at >= start).reduce((sum, s) => sum + s.amount, 0)
}

function pushFeed(item: FeedRow) {
  feed.unshift(item)
  if (feed.length > 100) feed.length = 100
}

const consentAt = new Map<string, string>()

// ---- API ----

export const mockApi: Api = {
  auth: {
    async sendOtp(phone_number) {
      await lag()
      const clean = phone_number.replace(/\s+/g, '')
      if (!/^\+?234\d{10}$|^0\d{10}$/.test(clean)) {
        fail('INVALID_PHONE', 'Enter a Nigerian number like 08012345678 or +2348012345678.')
      }
      otpIssued = '123456'
      return { otp: otpIssued, expires_at: new Date(Date.now() + 5 * 60_000).toISOString() }
    },
    async verifyOtp(_phone, otp) {
      await lag()
      if (otp !== otpIssued) fail('INVALID_OTP', 'That code is not right. Check it and try again.')
      return { token: 'mock-token', user_id: 'usr-1' }
    },
    async submitBvn(bvn) {
      await lag()
      requireAuth()
      if (!/^\d{11}$/.test(bvn)) fail('INVALID_BVN', 'A BVN has 11 digits.')
      return { verified: true, name: 'Adaeze Okafor' }
    },
    async setPin({ pin, confirm_pin }) {
      await lag()
      requireAuth()
      if (!/^\d{4,6}$/.test(pin)) fail('INVALID_PIN', 'Use a 4 to 6 digit PIN.')
      if (pin !== confirm_pin) fail('PIN_MISMATCH', 'The two PINs do not match.')
      return { status: 'set' }
    },
    async login({ phone, pin }) {
      await lag()
      const clean = phone.replace(/\s+/g, '')
      if (!/^\+?234\d{10}$|^0\d{10}$/.test(clean)) {
        fail('INVALID_PHONE', 'Enter a valid Nigerian phone number.')
      }
      if (!/^\d{4,6}$/.test(pin)) {
        fail('INVALID_PIN', 'PIN must be 4 to 6 digits.')
      }
      return { token: 'mock-token', user_id: 'usr-1' }
    },
    async logout() {
      await lag()
      session.clear()
      return { status: 'logged_out' }
    },
    async refresh() {
      await lag()
      return { token: 'mock-token' }
    },
  },
  banks: {
    async supported() {
      await lag()
      return {
        banks: supportedBanks,
        consent: {
          duration_days: 90,
          required: ['accounts'],
          scopes: [
            { id: 'accounts', label: 'Your account names and masked numbers' },
            { id: 'balances', label: 'Your account balances' },
            { id: 'transactions', label: 'Your transaction history' },
          ],
        },
      }
    },
    async link({ bank_name, consent }) {
      await lag()
      requireAuth()
      if (!consent) fail('CONSENT_REQUIRED', 'We need your consent to link this account.')
      const bank = supportedBanks.find((b) => b.name === bank_name)
      if (!bank?.supported) fail('BANK_UNSUPPORTED', `${bank_name} is coming soon.`, 422)
      if (accounts.some((a) => a.bank_name === bank_name)) fail('ALREADY_LINKED', `${bank_name} is already linked.`, 409)
      const account_id = `ACCT-${String(accounts.length + 1).padStart(3, '0')}`
      const masked_number = `*****${String(1000 + Math.floor(Math.random() * 9000))}`
      accounts = [...accounts, { account_id, bank_name, masked_number, balance_kobo: 1_000_000 }]
      consentAt.set(account_id, new Date().toISOString())
      return { account_id, masked_number }
    },
    async linked() {
      await lag()
      requireAuth()
      const links: BankLink[] = accounts.map((a) => {
        const at = consentAt.get(a.account_id) ?? iso(60 * 72)
        return {
          id: `LNK-${a.account_id}`,
          bank_code: a.bank_name.toLowerCase().replace(/[^a-z]+/g, ''),
          bank_name: a.bank_name,
          scopes: ['accounts', 'balances', 'transactions'],
          consent_at: at,
          consent_expires_at: new Date(new Date(at).getTime() + 90 * 24 * 60 * 60_000).toISOString(),
        }
      })
      return { links }
    },
    async revoke(id) {
      await lag()
      requireAuth()
      if (!accounts.some((a) => a.account_id === id)) fail('NOT_FOUND', 'That account is not linked.', 404)
      accounts = accounts.filter((a) => a.account_id !== id)
      return { status: 'revoked' }
    },
  },
  accounts: {
    async list() {
      await lag()
      requireAuth()
      return { accounts }
    },
  },
  dashboard: {
    async get() {
      await lag()
      requireAuth()
      const bank_cards = accounts.map((a) => ({
        bank_name: a.bank_name,
        balance_kobo: a.balance_kobo,
        unavailable: mockControls.banksDown.has(a.bank_name),
      }))
      return {
        total_balance_kobo: bank_cards.filter((c) => !c.unavailable).reduce((s, c) => s + c.balance_kobo, 0),
        bank_cards,
        transaction_feed: feed,
      }
    },
    async overrideCategory({ merchant, category }) {
      await lag()
      requireAuth()
      for (const f of feed) {
        if (f.counterparty?.toLowerCase() === merchant.toLowerCase()) {
          f.category = category
        }
      }
      return { status: 'updated' }
    },
  },
  splitPay: {
    async preview({ amount_kobo, recipient }) {
      await lag()
      requireAuth()
      if (!Number.isInteger(amount_kobo) || amount_kobo <= 0) fail('INVALID_AMOUNT', 'Enter an amount greater than zero.')
      let resolvedRecipient = { ...recipient }
      if (recipient.apapo_phone) {
        const clean = recipient.apapo_phone.replace(/[\s+-]/g, '')
        if (clean === '08012345678' || clean === '2348012345678') fail('SELF_SEND', 'You cannot send money to yourself.', 400)
        resolvedRecipient.recipient_type = 'apapo'
        resolvedRecipient.masked_display_name = clean.includes('98765432') ? 'Bola A.' : 'Adeola O.'
      } else if (!/^\d{10}$/.test(recipient.account_number ?? '')) {
        fail('INVALID_RECIPIENT', 'A recipient account number has 10 digits.')
      }
      if (amount_kobo > dailyLimitKobo) fail('DAILY_LIMIT_EXCEEDED', 'This is above your daily limit.', 422)
      const legs = plan(amount_kobo)
      const risk = resolvedRecipient.recipient_type === 'apapo' ? { tier: 'low' as RiskTier, reasons: [] } : riskFor(recipient)
      return {
        risk_tier: risk.tier,
        reasons: risk.reasons,
        legs,
        total_amount_kobo: amount_kobo,
        total_fee_kobo: legs.reduce((s, l) => s + l.fee_kobo, 0),
        duplicate_warning: recentSends.some((s) => s.amount === amount_kobo && Date.now() - s.at < 10 * 60_000),
        shield_warning: false,
        recipient: resolvedRecipient,
      }
    },
    async execute(req: ExecuteRequest, key) {
      await lag()
      requireAuth()
      if (!key) fail('IDEMPOTENCY_KEY_REQUIRED', 'Missing Idempotency-Key header.')
      // The mock has no stored PIN; like the real backend it refuses a missing or malformed one.
      if (!/^\d{4,6}$/.test(req.pin ?? '')) fail('INVALID_PIN', 'Wrong PIN.', 401)
      const existing = idempotency.get(key)
      if (existing) return { payment_id: existing, status: 'planned' }
      if (req.amount_kobo > dailyLimitKobo - spentTodayKobo()) fail('DAILY_LIMIT_EXCEEDED', 'This is above your daily limit.', 422)
      // Like the real backend, plan again here and ignore anything the client computed.
      const legs = plan(req.amount_kobo)
      const id = `PAY-${String(paySeq++).padStart(4, '0')}`
      payments.set(id, { id, legs, startedAt: Date.now(), fails: mockControls.forceFailure })
      idempotency.set(key, id)
      recentSends.push({ amount: legs.reduce((s, l) => s + l.amount_kobo, 0), at: Date.now() })
      const pruneCutoff = Math.min(startOfTodayWAT(), Date.now() - 10 * 60_000)
      for (let i = recentSends.length - 1; i >= 0; i--) {
        if (recentSends[i].at < pruneCutoff) recentSends.splice(i, 1)
      }
      return { payment_id: id, status: 'planned' }
    },
    async status(id) {
      await sleep(120)
      requireAuth()
      const p = payments.get(id)
      if (!p) fail('NOT_FOUND', 'We could not find that payment.', 404)
      return derivePayment(p)
    },
  },
  safeSend: {
    async riskCheck({ recipient }) {
      await lag()
      requireAuth()
      const r = riskFor(recipient)
      return { risk_tier: r.tier, reasons: r.reasons }
    },
    async shieldCheck(amount_kobo?: number) {
      await lag()
      requireAuth()
      const unverified = feed.find(
        (f) => f.id && !dismissedShields.has(f.id) && f.verification === 'unverified' && f.direction === 'incoming',
      )
      if (!unverified) {
        return { alert: null, matches_shield: false }
      }
      let matches = true
      if (amount_kobo) {
        const diff = Math.abs(amount_kobo - unverified.amount_kobo)
        matches = diff <= unverified.amount_kobo * 0.1
      }
      if (!matches) {
        return { alert: null, matches_shield: false }
      }
      return {
        alert: {
          title: 'Potential wrong-transfer scam',
          message: `You received an unconfirmed transfer of ${formatKobo(unverified.amount_kobo)} recently. Scammers often send money and ask for it back, then reverse the original deposit.`,
          credit_id: unverified.id ?? 'TXN-002',
          amount_kobo: unverified.amount_kobo,
        },
        matches_shield: true,
      }
    },
    async shieldDismiss(credit_id: string) {
      await lag()
      requireAuth()
      dismissedShields.add(credit_id)
      return { status: 'dismissed' }
    },
    async report(req) {
      await lag()
      requireAuth()
      if (!req.evidence_ref) fail('EVIDENCE_REQUIRED', 'Add a reference for the transaction you are reporting.')
      const report_id = `REP-${String(repSeq++).padStart(4, '0')}`
      audit.unshift({ action: 'scam_report_submitted', resource: report_id, timestamp: new Date().toISOString() })
      return { status: 'recorded', report_id }
    },
  },
  splitReceive: {
    async getRules() {
      await lag()
      requireAuth()
      return { rules: splitRules }
    },
    async setRules(req) {
      await lag()
      requireAuth()
      if (!req.standing_consent) {
        fail('CONSENT_REQUIRED', 'You must agree to automatic splitting. You can turn it off any time.')
      }
      if (!req.pin || req.pin.length < 4) {
        fail('INVALID_PIN', 'PIN is required to update Split-Receive rules.', 401)
      }
      if (!req.receiving_account_id) {
        fail('INVALID_RULES', 'Please select a receiving account.')
      }
      let totalPct = 0
      for (const d of req.destinations) {
        if (d.percent) totalPct += d.percent
      }
      if (totalPct > 100) {
        fail('INVALID_RULES', 'Total percentage split cannot exceed 100%.')
      }
      splitRules = {
        receiving_account_id: req.receiving_account_id,
        destinations: req.destinations,
        standing_consent_at: new Date().toISOString(),
        active: true,
        note: 'Whatever is not sent stays in the receiving account.',
      }
      audit.unshift({
        action: 'split_receive_rules_updated',
        resource: req.receiving_account_id,
        timestamp: new Date().toISOString(),
      })
      return { rules: splitRules }
    },
    async disableRules() {
      await lag()
      requireAuth()
      if (splitRules) {
        splitRules = { ...splitRules, active: false }
      }
      audit.unshift({
        action: 'split_receive_rules_disabled',
        resource: splitRules?.receiving_account_id ?? 'rules',
        timestamp: new Date().toISOString(),
      })
      return { status: 'disabled' }
    },
    async scan() {
      await lag()
      requireAuth()
      return { new_runs: [], ignored_unverified: 0 }
    },
    async runs(limit = 50) {
      await lag()
      requireAuth()
      return { runs: splitRuns.slice(0, limit) }
    },
    async getRun(id: string) {
      await lag()
      requireAuth()
      const run = splitRuns.find((r) => r.id === id)
      if (!run) fail('NOT_FOUND', 'Split-Receive run not found.', 404)
      return run
    },
    async retryRun(id: string) {
      await lag()
      requireAuth()
      const run = splitRuns.find((r) => r.id === id)
      if (!run) fail('NOT_FOUND', 'Split-Receive run not found.', 404)
      for (const leg of run.legs) {
        if (leg.state === 'failed') {
          leg.state = 'settled'
          leg.error = undefined
        }
      }
      run.state = 'settled'
      return run
    },
    async reconciliation() {
      await lag()
      requireAuth()
      const credits = splitRuns.map((r) => {
        let sent_kobo = 0
        let held_kobo = 0
        const entries: ReconciliationEntry[] = r.legs.map((l) => {
          if (l.state === 'settled') sent_kobo += l.amount_kobo
          else held_kobo += l.amount_kobo
          return {
            kind: 'sent' as const,
            amount_kobo: l.amount_kobo,
            fee_kobo: l.fee_kobo,
            destination: l.destination,
            state: l.state,
            error: l.error,
          }
        })
        const kept_kobo = Math.max(0, r.amount_kobo - sent_kobo - held_kobo)
        entries.push({
          kind: 'kept' as const,
          amount_kobo: kept_kobo,
          fee_kobo: 0,
        })
        return {
          run_id: r.id,
          credit_id: r.credit_id,
          received_at: r.received_at,
          amount_kobo: r.amount_kobo,
          run_state: r.state,
          entries,
          sent_kobo,
          held_kobo,
          kept_kobo,
          balanced: sent_kobo + held_kobo + kept_kobo === r.amount_kobo,
        }
      })
      const totals = {
        credits: credits.length,
        credit_kobo: credits.reduce((sum, c) => sum + c.amount_kobo, 0),
        sent_kobo: credits.reduce((sum, c) => sum + c.sent_kobo, 0),
        held_kobo: credits.reduce((sum, c) => sum + c.held_kobo, 0),
        kept_kobo: credits.reduce((sum, c) => sum + c.kept_kobo, 0),
        fees_kobo: splitRuns.reduce((sum, r) => sum + r.legs.reduce((ls, l) => ls + l.fee_kobo, 0), 0),
      }
      return { credits, totals }
    },
    async simulateCredit(req) {
      await lag()
      requireAuth()
      if (req.amount_kobo <= 0) fail('INVALID_AMOUNT', 'Amount must be greater than zero.')
      const acctId = req.account_id || splitRules?.receiving_account_id || 'ACCT-001'
      const acct = accounts.find((a) => a.account_id === acctId)
      if (!acct) fail('NOT_FOUND', 'Target account not found.')

      const verified = req.verified !== false
      const creditId = `TXN-${String(Math.floor(Math.random() * 900) + 100)}`
      const sender = req.sender_name || 'Ada Stores'
      const nowIso = new Date().toISOString()

      acct.balance_kobo += req.amount_kobo
      pushFeed({
        id: creditId,
        bank_name: acct.bank_name,
        amount_kobo: req.amount_kobo,
        direction: 'incoming',
        category: 'Transfer',
        verification: verified ? 'confirmed' : 'unverified',
        counterparty: sender,
        created_at: nowIso,

      })

      const newRuns: string[] = []
      let ignored = 0

      if (!verified) {
        ignored = 1
      } else if (splitRules && splitRules.active && splitRules.receiving_account_id === acctId) {
        const runId = `SR-${String(srSeq++).padStart(4, '0')}`
        const legs: SplitReceiveLeg[] = []
        let position = 1
        for (const dest of splitRules.destinations) {
          let legAmount = 0
          if (dest.percent) {
            legAmount = Math.round((req.amount_kobo * dest.percent) / 100)
          } else if (dest.fixed_kobo) {
            legAmount = Math.min(dest.fixed_kobo, req.amount_kobo)
          }
          if (legAmount > 0) {
            legs.push({
              id: `${runId}-LEG-${position}`,
              position,
              destination: dest,
              amount_kobo: legAmount,
              fee_kobo: 2500,
              state: 'settled',
            })
            if (dest.account_id) {
              const destAcct = accounts.find((a) => a.account_id === dest.account_id)
              if (destAcct) {
                destAcct.balance_kobo += legAmount
                pushFeed({
                  id: `${runId}-CREDIT-${position}`,
                  bank_name: destAcct.bank_name,
                  amount_kobo: legAmount,
                  direction: 'incoming',
                  category: 'Transfer',
                  verification: 'confirmed',
                  counterparty: `Split-Receive from ${acct.bank_name}`,
                  is_internal: true,
                  created_at: nowIso,
                })
              }
              acct.balance_kobo -= legAmount
              pushFeed({
                id: `${runId}-DEBIT-${position}`,
                bank_name: acct.bank_name,
                amount_kobo: -legAmount,
                direction: 'outgoing',
                category: 'Transfer',
                verification: 'confirmed',
                counterparty: `Split-Receive to ${destAcct?.bank_name ?? 'Linked Account'}`,
                is_internal: true,
                created_at: nowIso,
              })
            } else {
              acct.balance_kobo -= legAmount
              pushFeed({
                id: `${runId}-DEBIT-${position}`,
                bank_name: acct.bank_name,
                amount_kobo: -legAmount,
                direction: 'outgoing',
                category: 'Transfer',
                verification: 'confirmed',
                counterparty: `Split-Receive to ${dest.beneficiary?.account_name ?? 'Beneficiary'}`,
                created_at: nowIso,
              })
            }

            position++
          }
        }
        const run: SplitReceiveRun = {
          id: runId,
          credit_id: creditId,
          account_id: acctId,
          amount_kobo: req.amount_kobo,
          received_at: new Date().toISOString(),
          state: 'settled',
          message: 'Incoming credit divided across destinations successfully.',
          legs,
          created_at: nowIso,
          updated_at: new Date().toISOString(),
        }
        splitRuns.unshift(run)
        newRuns.push(runId)
      }

      return {
        credit: {
          id: creditId,
          account_id: acctId,
          amount_kobo: req.amount_kobo,
          sender,
          verified,
        },
        scan: {
          new_runs: newRuns,
          ignored_unverified: ignored,
        },
      }
    },
  },
  insights: {
    async shifts() {
      await lag()
      requireAuth()
      return { shifts }
    },
  },
  security: {
    async audit() {
      await lag()
      requireAuth()
      return [...audit].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    },
    async getLimits() {
      await lag()
      requireAuth()
      const spent = spentTodayKobo()
      return {
        daily_limit_kobo: dailyLimitKobo,
        spent_today_kobo: spent,
        remaining_kobo: Math.max(0, dailyLimitKobo - spent),
        min_limit_kobo: LIMIT_MIN_KOBO,
        max_limit_kobo: LIMIT_MAX_KOBO,
      }
    },
    async setLimits(next, pin) {
      await lag()
      requireAuth()
      if (!/^\d{4,6}$/.test(pin ?? '')) fail('INVALID_PIN', 'Wrong PIN.', 401)
      if (next.daily_limit_kobo < LIMIT_MIN_KOBO || next.daily_limit_kobo > LIMIT_MAX_KOBO)
        fail('INVALID_LIMIT', 'Your daily limit must be between N1,000 and N10,000,000.')
      dailyLimitKobo = next.daily_limit_kobo
      return { status: 'updated' }
    },
    async sessions() {
      await lag()
      requireAuth()
      return sessions
    },
    async logoutAll() {
      await lag()
      requireAuth()
      sessions = []
      session.clear()
      return { status: 'logged_out' }
    },
  },
  users: {
    async lookup(phone: string) {
      await lag()
      requireAuth()
      const clean = phone.replace(/[\s+-]/g, '')
      if (clean === '08012345678' || clean === '2348012345678') {
        fail('SELF_SEND', 'You cannot send money to yourself.', 400)
      }
      if (!/^(0|234)\d{10}$/.test(clean)) {
        fail('INVALID_PHONE', 'Enter a valid Nigerian phone number.', 400)
      }
      const isBola = clean.includes('98765432')
      return {
        user: {
          recipient_type: 'apapo' as const,
          display_name: isBola ? 'Bola A.' : 'Adeola O.',
        },
      }
    },
  },
  me: {
    async get() {
      await lag()
      requireAuth()
      const rec = accounts.find((a) => a.account_id === mockProfile.receiving_account_id) ?? accounts[0] ?? null
      return {
        user: {
          id: 'usr-1',
          phone: '08012345678',
          display_name: mockProfile.display_name,
          bvn_verified: true,
          pin_set: true,
        },
        onboarding: { bvn_verified: true, pin_set: true, complete: true },
        display_name: mockProfile.display_name,
        receiving_account: rec,
      }
    },
    async updateProfile({ display_name }) {
      await lag()
      requireAuth()
      const trimmed = (display_name ?? '').trim()
      if (!trimmed || trimmed.length > 80) fail('INVALID_DISPLAY_NAME', 'Name must be 1 to 80 characters.')
      mockProfile.display_name = trimmed
      return {
        user: {
          id: 'usr-1',
          phone: '08012345678',
          display_name: trimmed,
          bvn_verified: true,
          pin_set: true,
        },
      }
    },
    async setReceivingAccount(accountId: string) {
      await lag()
      requireAuth()
      const found = accounts.find((a) => a.account_id === accountId)
      if (!found) fail('NOT_FOUND', 'Linked account not found.', 404)
      mockProfile.receiving_account_id = accountId
      return { receiving_account: found }
    },
  },
  recipients: {
    async recent(limit = 20) {
      await lag()
      requireAuth()
      return {
        recipients: [
          { recipient_type: 'apapo' as const, masked_display_name: 'Bola A.' },
          { recipient_type: 'outside' as const, bank_code: 'access', account_number: '0123456789', account_name: 'Mama Put Kitchen' },
          { recipient_type: 'outside' as const, bank_code: 'gtb', account_number: '0987654321', account_name: 'Bolt Nigeria' },
        ].slice(0, limit),
      }
    },
  },
  demo: {
    async setFailure(req) {
      if (req.mode === 'none') {
        mockControls.forceFailure = false
        mockControls.banksDown.clear()
      } else {
        mockControls.forceFailure = true
        if (req.bank_code) {
          // Map code to bank name if needed
          const nameMap: Record<string, string> = {
            savanna: 'Savanna Bank',
            apex: 'Apex Bank',
            delta: 'Delta Trust Bank',
            harbor: 'Harbor MFB',
            zenith: 'Zenith Bank',
            gtb: 'GTBank',
            access: 'Access Bank',
            uba: 'UBA',
          }
          const bankName = nameMap[req.bank_code.toLowerCase()] || req.bank_code
          mockControls.banksDown.add(bankName)
        }
      }
      return { status: 'ok' }
    },
  },
}
