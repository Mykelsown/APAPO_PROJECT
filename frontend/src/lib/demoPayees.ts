import type { Recipient, RiskTier } from '../api/types'

/**
 * Demo recipients for showing every Safe Send path. The account numbers are the ones the Go
 * backend's mock bank ships (low: a known payee, unknown: no history, high: reported by many).
 * Bank codes differ because the in-browser mock lists the pitch banks, the backend its own four.
 */
export const DEMO_NUMBERS = {
  low: '1000000001',
  unknown: '2000000001',
  high: '9000000001',
} as const

export interface DemoPayee {
  label: string
  tier: RiskTier
  recipient: Recipient
}

export function demoPayees(mode: 'mock' | 'real'): DemoPayee[] {
  const codes = mode === 'real' ? { low: 'apex', unknown: 'delta', high: 'apex' } : { low: 'access', unknown: 'gtb', high: 'access' }
  return [
    {
      label: 'Ada N. (Trusted payee)',
      tier: 'low',
      recipient: { bank_code: codes.low, account_number: DEMO_NUMBERS.low, account_name: 'Ada Okafor' },
    },
    {
      label: 'New payee (Unverified)',
      tier: 'unknown',
      recipient: { bank_code: codes.unknown, account_number: DEMO_NUMBERS.unknown },
    },
    {
      label: 'Flagged Account (High Risk Scam)',
      tier: 'high',
      recipient: { bank_code: codes.high, account_number: DEMO_NUMBERS.high, account_name: 'Quick Returns Investments' },
    },
  ]
}

export function describeRecipient(r: Recipient): string {
  if (r.apapo_phone) {
    return r.masked_display_name ? `${r.masked_display_name} (${r.apapo_phone})` : r.apapo_phone
  }
  return r.account_name ? `${r.account_name} (${r.account_number ?? ''})` : (r.account_number ?? '')
}
