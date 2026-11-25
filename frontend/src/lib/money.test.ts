import { describe, expect, it } from 'vitest'
import { formatKobo, parseNairaToKobo } from './money'

describe('money helper', () => {
  it('formats positive integer kobo to Nigerian Naira currency string', () => {
    expect(formatKobo(100_000)).toContain('1,000.00')
    expect(formatKobo(0)).toContain('0.00')
    expect(formatKobo(50)).toContain('0.50')
  })

  it('formats negative integer kobo with negative sign', () => {
    expect(formatKobo(-420_000)).toContain('-')
    expect(formatKobo(-420_000)).toContain('4,200.00')
  })

  it('masks balances when hide parameter is true', () => {
    expect(formatKobo(100_000, true)).toBe('₦ ••••••••')
    expect(formatKobo(-420_000, true)).toBe('-₦ ••••••••')
  })

  it('throws an error if kobo is not an integer', () => {
    expect(() => formatKobo(12.34)).toThrow('Money must be integer kobo')
  })

  it('parses valid naira user strings into integer kobo', () => {
    expect(parseNairaToKobo('1,000')).toBe(100_000)
    expect(parseNairaToKobo('1500.50')).toBe(150_050)
    expect(parseNairaToKobo('₦25,000')).toBe(2_500_000)
    expect(parseNairaToKobo('0.75')).toBe(75)
  })

  it('returns null for invalid naira input', () => {
    expect(parseNairaToKobo('')).toBeNull()
    expect(parseNairaToKobo('abc')).toBeNull()
    expect(parseNairaToKobo('-500')).toBeNull()
    expect(parseNairaToKobo('12.345')).toBeNull()
  })
})
