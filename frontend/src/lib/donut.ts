export const BANK_COLORS: Record<string, string> = {
  'Access Bank': '#F37023',
  GTBank: '#E05A10',
  'Zenith Bank': '#D2232A',
  UBA: '#BA0C12',
  'Kuda Bank': '#40196D',
  'First Bank': '#002B49',
  'Apex Bank': '#0f766e',
  'Delta Trust Bank': '#1d3557',
  'Savanna Bank': '#b05817',
  'Harbor MFB': '#28536b',
}

export const FALLBACK_BANK_COLORS = ['#0f766e', '#0284c7', '#7c3aed', '#db2777', '#d97706', '#059669']

export const DONUT_RADIUS = 56

/** Turns amounts into SVG stroke-dash slices that sit end to end around a circle. */
export function buildDonutSegments<T extends { amountKobo: number }>(items: T[], radius: number) {
  const circumference = 2 * Math.PI * radius
  const total = items.reduce((sum, item) => sum + item.amountKobo, 0) || 1
  let accumulated = 0
  return items.map((item) => {
    const sliceLength = (item.amountKobo / total) * circumference
    const slice = {
      ...item,
      radius,
      circumference,
      strokeDasharray: `${sliceLength} ${circumference}`,
      strokeDashoffset: -accumulated,
    }
    accumulated += sliceLength
    return slice
  })
}
