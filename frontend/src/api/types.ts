// Types mirror docs/api-contract.md on the backend branch. Fields marked
// "extension" are not in the contract yet and are optional until agreed with the backend.

export type RiskTier = 'low' | 'unknown' | 'high'
export type LegState = 'pending' | 'collected' | 'failed' | 'reversed'
export type PaymentState =
  | 'planned'
  | 'collecting'
  | 'sending'
  | 'completed'
  | 'rolled_back'
  | 'needs_attention'
export type CreditVerification = 'confirmed' | 'unverified'
export type ReportStatus = 'open' | 'in_review' | 'resolved'
export type SplitReceiveRunState =
  | 'detected'
  | 'splitting'
  | 'settled'
  | 'partially_settled'
  | 'needs_attention'

export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
}

// Auth
export interface AuthUser {
  id: string
  phone: string
  bvn_verified: boolean
  pin_set: boolean
}
export interface OtpResponse {
  /** Only present when the backend runs with a dev code (mock mode). */
  otp?: string
  expires_at: string
}
export interface VerifyOtpResponse {
  token: string
  user_id: string
  user?: AuthUser
}
export interface BvnResponse {
  verified: boolean
  /** The backend does not return a name. Shown only when present. */
  name?: string
}
export interface PinRequest {
  pin: string
  confirm_pin: string
}
export interface LoginRequest {
  phone: string
  pin: string
}
export interface LoginResponse {
  token: string
  user_id: string
  user?: AuthUser
}

// Banks and accounts
export interface SupportedBank {
  name: string
  supported: boolean
  flag?: 'coming_soon'
  code?: string
}
export interface ConsentInfo {
  duration_days: number
  required: string[]
  scopes: { id: string; label: string }[]
}
export interface SupportedBanksResponse {
  banks: SupportedBank[]
  consent?: ConsentInfo
}
/** Linking is by bank and consent only. The backend takes no account number. */
export interface LinkBankRequest {
  bank_name: string
  consent: boolean
}
export interface LinkBankResponse {
  account_id: string
  masked_number: string
}
export interface Account {
  account_id: string
  bank_name: string
  masked_number: string
  balance_kobo: number
  bank_code?: string // extension
  link_id?: string // extension
  account_name?: string // extension
}
export interface BankLink {
  id: string
  bank_code: string
  bank_name: string
  scopes: string[]
  consent_at: string
  consent_expires_at: string
}

// Dashboard
export interface BankCard {
  bank_name: string
  balance_kobo: number
  unavailable: boolean
}
export interface FeedRow {
  id?: string // extension
  bank_name: string
  amount_kobo: number
  direction: 'incoming' | 'outgoing'
  category: string
  verification: CreditVerification
  counterparty?: string // extension
  created_at?: string // extension
  is_internal?: boolean // extension: true for transfers between user's own linked accounts
}
export interface Dashboard {
  total_balance_kobo: number
  bank_cards: BankCard[]
  transaction_feed: FeedRow[]
}
export interface CategoryOverrideRequest {
  merchant: string
  category: string
}

// Split-Pay
export interface Recipient {
  bank_code?: string
  account_number?: string
  account_name?: string
  apapo_phone?: string
  recipient_type?: 'apapo' | 'outside'
  masked_display_name?: string
}
export interface PreviewRequest {
  amount_kobo: number
  recipient: Recipient
}
export interface PreviewLeg {
  account_id: string
  bank_name: string
  amount_kobo: number
  fee_kobo: number
}
export interface PreviewResponse {
  risk_tier: RiskTier
  reasons?: string[] // extension, contract returns reasons only from /risk/check
  legs: PreviewLeg[]
  total_amount_kobo: number
  total_fee_kobo: number
  duplicate_warning: boolean
  shield_warning: boolean
  recipient?: Recipient
}
/** The backend plans again itself and never trusts client legs. It needs the user's PIN. */
export interface ExecuteRequest {
  amount_kobo: number
  recipient: Recipient
  pin: string
}
export interface ExecuteResponse {
  payment_id: string
  status: PaymentState
}
export interface PaymentLeg {
  account_id: string
  bank_name?: string // extension
  amount_kobo: number
  state: LegState
  risk_tier?: RiskTier
}
export interface PaymentStatus {
  payment_id: string
  state: PaymentState
  legs: PaymentLeg[]
  message: string
  reversal_attempt_count?: number
  next_reversal_retry_at?: string
  last_reversal_attempt_at?: string
  human_review?: boolean
}

// Identity, Profile & P2P Lookup
export interface UserProfile {
  id: string
  phone: string
  display_name?: string
  bvn_verified: boolean
  pin_set: boolean
}

export interface MeResponse {
  user: UserProfile
  onboarding: {
    bvn_verified: boolean
    pin_set: boolean
    complete: boolean
  }
  display_name?: string
  receiving_account?: Account | null
}

export interface UpdateProfileRequest {
  display_name: string
}

export interface ReceivingAccountRequest {
  account_id: string
}

export interface UserLookupResponse {
  user: {
    recipient_type: 'apapo'
    display_name: string
  }
}

export interface RecentRecipient {
  recipient_type: 'apapo' | 'outside'
  masked_display_name?: string
  bank_code?: string
  account_number?: string
  account_name?: string
  apapo_phone?: string
}

export interface RecentRecipientsResponse {
  recipients: RecentRecipient[]
}

// Safe Send
export interface RiskCheckRequest {
  amount_kobo: number
  recipient: Recipient
}
export interface RiskCheckResponse {
  risk_tier: RiskTier
  reasons: string[]
  flags?: string[]
}
export interface ShieldAlert {
  title?: string
  message: string
  credit_id: string
  amount_kobo?: number
}
export interface ShieldCheckResponse {
  alert: ShieldAlert | null
  matches_shield?: boolean
  reason?: string
}
export interface SafeSendReportRequest {
  recipient: {
    bank_code: string
    account_number: string
  }
  evidence_ref: string
}
export interface SafeSendReportResponse {
  status: 'recorded' | 'already_reported'
  report_id?: string
}

// Split-Receive
export interface DestinationInput {
  account_id?: string
  beneficiary?: {
    bank_code: string
    account_number: string
    account_name: string
  }
  percent?: number
  fixed_kobo?: number
}

export interface SplitReceiveRules {
  receiving_account_id: string
  destinations: DestinationInput[]
  standing_consent_at: string
  active: boolean
  note?: string
}

export interface PutRulesRequest {
  receiving_account_id: string
  destinations: DestinationInput[]
  standing_consent: boolean
  pin: string
}

export interface SplitReceiveLeg {
  id: string
  position: number
  destination: DestinationInput
  amount_kobo: number
  fee_kobo: number
  state: string
  error?: string
}

export interface SplitReceiveRun {
  id: string
  credit_id: string
  account_id: string
  amount_kobo: number
  received_at: string
  state: SplitReceiveRunState
  message?: string
  legs: SplitReceiveLeg[]
  created_at: string
  updated_at: string
}

export interface ScanResponse {
  new_runs: string[]
  ignored_unverified: number
}

export interface ReconciliationEntry {
  kind: 'sent' | 'held' | 'kept'
  amount_kobo: number
  fee_kobo: number
  destination?: DestinationInput
  state?: string
  error?: string
}

export interface ReconciliationCredit {
  run_id: string
  credit_id: string
  received_at: string
  amount_kobo: number
  run_state: SplitReceiveRunState
  entries: ReconciliationEntry[]
  sent_kobo: number
  held_kobo: number
  kept_kobo: number
  balanced: boolean
}

export interface ReconciliationTotals {
  credits: number
  credit_kobo: number
  sent_kobo: number
  held_kobo: number
  kept_kobo: number
  fees_kobo: number
}

export interface ReconciliationResponse {
  credits: ReconciliationCredit[]
  totals: ReconciliationTotals
}

export interface SimulateCreditRequest {
  amount_kobo: number
  sender_name?: string
  verified?: boolean
  account_id?: string
}

export interface SimulateCreditResponse {
  credit: {
    id: string
    account_id: string
    amount_kobo: number
    sender: string
    verified: boolean
  }
  scan?: ScanResponse
}

export interface DemoFailureRequest {
  bank_code?: string
  account_id?: string
  mode: 'timeout' | 'insufficient_funds' | 'bank_down' | 'reversal_down' | 'none'
}

// Insights
export interface Shift {
  category: string
  previous_total_kobo: number
  current_total_kobo: number
  percent_change: number
  transaction_count_prev: number
  transaction_count_curr: number
  avg_amount_prev: number
  avg_amount_curr: number
  weekend_share_prev: number
  weekend_share_curr: number
  top_counterparties: string[]
  supporting_transaction_ids: string[]
  direction?: 'up' | 'down' // extension
  summary?: string // extension
}

// Security
export interface AuditEntry {
  action: string
  resource: string
  timestamp: string
  details?: string
}
/** Daily limit only: the backend has no monthly limit. */
export interface Limits {
  daily_limit_kobo: number
  spent_today_kobo?: number
  remaining_kobo?: number
  min_limit_kobo?: number
  max_limit_kobo?: number
}
export interface Session {
  id: string
  current: boolean
  device?: string
  created_at?: string
  expires_at?: string
}
