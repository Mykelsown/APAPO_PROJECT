export interface RunwayShare {
  id: string
  name: string
  percent: number
  amountKobo: number
  color: string
}

/**
 * The "How long your money lasts" figures. These are an illustrative model, not the user's real
 * spending: daily burn is assumed to be total/45 and the split is a fixed 35/25/40 rule of thumb.
 */
export function computeRunway(totalKobo: number) {
  const dailyBurnKobo = Math.max(100_000, Math.round(totalKobo / 45))
  const runwayDays = Math.max(1, Math.round(totalKobo / dailyBurnKobo))
  const fixedBillsKobo = Math.round(totalKobo * 0.35)
  const livingKobo = Math.round(totalKobo * 0.25)
  const bufferKobo = Math.max(0, totalKobo - fixedBillsKobo - livingKobo)

  const shares: RunwayShare[] = [
    { id: 'bills', name: 'Bills & Essentials', percent: 35, amountKobo: fixedBillsKobo, color: '#059669' }, // Emerald
    { id: 'daily', name: 'Daily Spending', percent: 25, amountKobo: livingKobo, color: '#0284c7' }, // Sky
    { id: 'savings', name: 'Emergency Savings', percent: 40, amountKobo: bufferKobo, color: '#6366f1' }, // Indigo
  ]
  return { dailyBurnKobo, runwayDays, shares }
}
