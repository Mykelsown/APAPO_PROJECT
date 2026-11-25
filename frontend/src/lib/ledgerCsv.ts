import type { ReconciliationResponse } from '../api/types'

const naira = (kobo: number) => (kobo / 100).toFixed(2)

/** The settlement ledger as CSV text. `exportedAt` is passed in so the output is predictable. */
export function ledgerToCsv(rec: ReconciliationResponse, exportedAt: Date): string {
  return [
    'Apapo Settlement Ledger Export',
    `Exported: ${exportedAt.toISOString()}`,
    `Total Inflow (NGN),${naira(rec.totals.credit_kobo)}`,
    `Auto Distributed (NGN),${naira(rec.totals.sent_kobo)}`,
    `Kept in Source (NGN),${naira(rec.totals.kept_kobo)}`,
    `Platform Fees (NGN),${naira(rec.totals.fees_kobo)}`,
    '',
    'Run ID,Credit ID,Date Received,Credited (NGN),Status,Distributed (NGN),Kept in Source (NGN),Held (NGN),Balanced',
    ...rec.credits.map((c) =>
      [
        c.run_id,
        c.credit_id,
        c.received_at,
        naira(c.amount_kobo),
        c.run_state,
        naira(c.sent_kobo),
        naira(c.kept_kobo),
        naira(c.held_kobo),
        c.balanced ? 'YES' : 'NO',
      ].join(','),
    ),
  ].join('\n')
}
