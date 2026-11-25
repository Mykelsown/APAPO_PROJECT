const naira = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
})

/** The single place kobo becomes a display string. */
export function formatKobo(kobo: number, hide = false): string {
  if (hide) {
    const sign = kobo < 0 ? '-' : ''
    return `${sign}₦ ••••••••`
  }
  if (!Number.isInteger(kobo)) {
    throw new Error(`Money must be integer kobo, got ${kobo}`)
  }
  const sign = kobo < 0 ? '-' : ''
  return sign + naira.format(Math.abs(kobo) / 100)
}

/** Parses user-typed naira text ("1,500.50") to integer kobo. Returns null if invalid. */
export function parseNairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[,\s₦]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole, frac = ''] = cleaned.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}
