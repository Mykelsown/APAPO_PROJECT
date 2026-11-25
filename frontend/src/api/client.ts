import { mockApi, mockControls } from './mock'
import { realApi } from './real'
import type * as T from './types'

/** Every network call in the app goes through this interface. */
export interface Api {
  auth: {
    sendOtp(phone_number: string): Promise<T.OtpResponse>
    verifyOtp(phone_number: string, otp: string): Promise<T.VerifyOtpResponse>
    submitBvn(bvn: string): Promise<T.BvnResponse>
    setPin(req: T.PinRequest): Promise<{ status: string }>
    login(req: T.LoginRequest): Promise<T.LoginResponse>
    logout(): Promise<{ status: string }>
    refresh(): Promise<{ token: string }>
  }
  banks: {
    supported(): Promise<T.SupportedBanksResponse>
    link(req: T.LinkBankRequest): Promise<T.LinkBankResponse>
    linked(): Promise<{ links: T.BankLink[] }>
    revoke(accountId: string): Promise<{ status: string }>
  }
  accounts: { list(): Promise<{ accounts: T.Account[] }> }
  dashboard: {
    get(): Promise<T.Dashboard>
    overrideCategory(req: T.CategoryOverrideRequest): Promise<{ status: string }>
  }
  splitPay: {
    preview(req: T.PreviewRequest): Promise<T.PreviewResponse>
    execute(req: T.ExecuteRequest, idempotencyKey: string): Promise<T.ExecuteResponse>
    status(paymentId: string): Promise<T.PaymentStatus>
  }
  safeSend: {
    riskCheck(req: T.RiskCheckRequest): Promise<T.RiskCheckResponse>
    shieldCheck(amount_kobo?: number): Promise<T.ShieldCheckResponse>
    shieldDismiss(credit_id: string): Promise<{ status: string }>
    report(req: T.SafeSendReportRequest): Promise<T.SafeSendReportResponse>
  }
  splitReceive: {
    getRules(): Promise<{ rules: T.SplitReceiveRules | null }>
    setRules(req: T.PutRulesRequest): Promise<{ rules: T.SplitReceiveRules }>
    disableRules(): Promise<{ status: string }>
    scan(): Promise<T.ScanResponse>
    runs(limit?: number): Promise<{ runs: T.SplitReceiveRun[] }>
    getRun(id: string): Promise<T.SplitReceiveRun>
    retryRun(id: string): Promise<T.SplitReceiveRun>
    reconciliation(from?: string, to?: string): Promise<T.ReconciliationResponse>
    simulateCredit(req: T.SimulateCreditRequest): Promise<T.SimulateCreditResponse>
  }
  insights: { shifts(): Promise<{ shifts: T.Shift[] }> }
  security: {
    audit(): Promise<T.AuditEntry[]>
    getLimits(): Promise<T.Limits>
    setLimits(limits: T.Limits, pin: string): Promise<{ status: string }>
    sessions(): Promise<T.Session[]>
    logoutAll(): Promise<{ status: string }>
  }
  users: {
    lookup(phone: string): Promise<T.UserLookupResponse>
  }
  me: {
    get(): Promise<T.MeResponse>
    updateProfile(req: T.UpdateProfileRequest): Promise<{ user: T.UserProfile }>
    setReceivingAccount(accountId: string): Promise<{ receiving_account: T.Account }>
  }
  recipients: {
    recent(limit?: number): Promise<T.RecentRecipientsResponse>
  }
  demo: {
    setFailure(req: T.DemoFailureRequest): Promise<{ status: string }>
  }
}

export const apiMode: 'mock' | 'real' = import.meta.env.VITE_API_MODE === 'real' ? 'real' : 'mock'

export const api: Api = apiMode === 'real' ? realApi : mockApi

/** Demo switches, only effective in mock mode. */
export const demo = mockControls
