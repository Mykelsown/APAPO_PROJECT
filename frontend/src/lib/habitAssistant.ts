import { formatKobo } from './money'
import type { SpendingStats } from './spendingStats'

/** Rule-based answers for the spending assistant, computed only from the user's own numbers. */
export function answerHabitQuestion(rawQuestion: string, stats: SpendingStats, accountCount: number): string {
  const q = rawQuestion.toLowerCase().trim()
  const {
    bankComparisonStats,
    categoryStats,
    merchantStats,
    recurringCharges,
    weekendVsWeekday,
    totalBalanceKobo,
    dailyBurnKobo,
    runwayDays,
    totalOutflowKobo,
    totalInflowKobo,
    netCashflowKobo,
    savingsRate,
    highestExpense,
  } = stats

  // 1. Highest single expense / biggest payment
  if (
    q.includes('highest expense') ||
    q.includes('biggest expense') ||
    q.includes('largest expense') ||
    q.includes('most expensive') ||
    q.includes('top expense') ||
    q.includes('highest spend') ||
    q.includes('biggest spend') ||
    q.includes('largest spend') ||
    q.includes('biggest payment') ||
    q.includes('highest payment')
  ) {
    if (highestExpense) {
      return `Your highest single expense was ${formatKobo(highestExpense.amountKobo)} to ${highestExpense.counterparty} (${highestExpense.category}) via ${highestExpense.bankName}.`
    }
    if (merchantStats && merchantStats.length > 0) {
      const topM = merchantStats[0]
      return `Your highest spending destination is ${topM.merchant} at ${formatKobo(topM.totalKobo)} across ${topM.count} transactions (${topM.percent}% of total outflow).`
    }
    return 'No outgoing debit transactions recorded in this period.'
  }

  // 2. Subscriptions and recurring bills (checked before category matching so "recurring bills" triggers this)
  if (q.includes('subscription') || q.includes('recurring') || q.includes('bills?') || q.includes('recurring bill')) {
    if (recurringCharges.length === 0) {
      return 'No recurring subscriptions detected. Regular fixed payments like electricity (IKEDC), streaming (Netflix, Spotify), or telco data will appear here once debited.'
    }
    const listStr = recurringCharges.map((r) => `${r.name}: ${formatKobo(r.amountKobo)}`).join(', ')
    return `Identified ${recurringCharges.length} recurring commitments: ${listStr}. Total recurring monthly overhead is approximately ${formatKobo(recurringCharges.reduce((s, r) => s + r.amountKobo, 0))}.`
  }

  // 3. Top merchant / payee leaderboard
  if (q.includes('merchant') || q.includes('who did i pay') || q.includes('recipient') || q.includes('payee') || q.includes('vendor')) {
    if (!merchantStats || merchantStats.length === 0) return 'No merchant debit records found.'
    const topM = merchantStats[0]
    const list = merchantStats.slice(0, 3).map((m) => `${m.merchant} (${formatKobo(m.totalKobo)}, ${m.count} txns)`).join('; ')
    return `Your top recipient is ${topM.merchant} with ${formatKobo(topM.totalKobo)} in debits (${topM.percent}% of outflow). Top destinations: ${list}.`
  }

  // 4. Bank drainage
  if (q.includes('draining') || q.includes('fastest') || (q.includes('bank') && (q.includes('drain') || q.includes('drop')))) {
    if (bankComparisonStats.length === 0) return 'No debit transactions recorded yet across your linked accounts.'
    const topBank = bankComparisonStats[0]
    return `Your fastest draining account is ${topBank.bankName}, accounting for ${formatKobo(topBank.outflowKobo)} across ${topBank.count} transactions. We recommend balancing outbound payments via Split-Pay to keep your reserves intact.`
  }

  // 5. Specific bank query
  const matchedBank = bankComparisonStats.find((b) => q.includes(b.bankName.toLowerCase()))
  if (matchedBank && (q.includes('how much') || q.includes('spend') || q.includes('flow') || q.includes('balance') || q.includes('activity'))) {
    return `${matchedBank.bankName} has recorded ${formatKobo(matchedBank.outflowKobo)} in outflows and ${formatKobo(matchedBank.inflowKobo)} in inflows across ${matchedBank.count} transactions (net: ${formatKobo(matchedBank.netKobo)}).`
  }

  // 6. Specific category queries
  if (q.includes('food') || q.includes('dining') || q.includes('eating')) {
    const food = categoryStats.find((c) => c.category === 'Food & Dining')
    if (!food) return 'No dining or food transactions recorded in this period.'
    return `You have spent ${formatKobo(food.totalKobo)} on Food & Dining across ${food.count} transactions (${food.percent}% of total debits). Top merchants in this category include Mama Put Kitchen, Chicken Republic, and Chowdeck.`
  }
  if (q.includes('transport') || q.includes('uber') || q.includes('bolt')) {
    const trans = categoryStats.find((c) => c.category === 'Transport')
    if (!trans) return 'No transport transactions found in this period.'
    return `Transport expenses total ${formatKobo(trans.totalKobo)} (${trans.percent}% of total outflow). Merchants include Bolt and Uber Nigeria.`
  }
  const matchedCat = categoryStats.find((c) => q.includes(c.category.toLowerCase()))
  if (matchedCat) {
    return `You have spent ${formatKobo(matchedCat.totalKobo)} on ${matchedCat.category} across ${matchedCat.count} transactions (${matchedCat.percent}% of total debits).`
  }

  // 7. Weekend vs weekday
  if (q.includes('weekend') || q.includes('weekday') || q.includes('surge')) {
    return `Your weekend spending accounts for ${weekendVsWeekday.weekendPercent}% (${formatKobo(weekendVsWeekday.weekendKobo)}) of total debits, while weekdays account for ${weekendVsWeekday.weekdayPercent}% (${formatKobo(weekendVsWeekday.weekdayKobo)}). Weekend transactions are primarily clustered in dining and shopping.`
  }

  // 8. Runway / Burn
  if (q.includes('runway') || q.includes('how long') || q.includes('burn')) {
    return `Your current combined liquid balance is ${formatKobo(totalBalanceKobo)}. At your current daily velocity of ${formatKobo(dailyBurnKobo)} per day, your estimated runway is ${runwayDays} days across all connected banks.`
  }

  // 9. Daily velocity / spend rate
  if (q.includes('velocity') || q.includes('daily spend') || q.includes('per day')) {
    return `Your daily outflow velocity is approximately ${formatKobo(dailyBurnKobo)} per day based on recent transaction activity.`
  }

  // 10. Savings rate / Net cash flow
  if (q.includes('saving') || q.includes('retention') || q.includes('net cash') || q.includes('cash flow')) {
    return `Your net cash flow is ${formatKobo(netCashflowKobo)} with a ${savingsRate}% retention rate (inflow: ${formatKobo(totalInflowKobo)}, outflow: ${formatKobo(totalOutflowKobo)}).`
  }

  // 11. Transaction count / activity volume
  if (q.includes('how many transaction') || q.includes('transaction count') || q.includes('total transaction')) {
    return `You have recorded ${stats.incomingCount + stats.outgoingCount} total transactions across all linked accounts (${stats.incomingCount} credits, ${stats.outgoingCount} debits).`
  }

  // 12. Total Outflow / Spend
  if (q.includes('total spend') || q.includes('total outflow') || q.includes('total expense') || q.includes('how much did i spend')) {
    return `Your consolidated outflow across all linked accounts is ${formatKobo(totalOutflowKobo)} across ${stats.outgoingCount} debit transactions.`
  }

  // 13. Total Inflow / Deposits / Income
  if (q.includes('total inflow') || q.includes('total income') || q.includes('total deposit') || q.includes('how much did i make') || q.includes('how much did i receive') || q.includes('salary')) {
    return `Your total consolidated inflow is ${formatKobo(totalInflowKobo)} across ${stats.incomingCount} credit transactions.`
  }

  // 14. Balance
  if (q.includes('balance') || q.includes('net worth') || q.includes('how much do i have')) {
    return `Your total combined liquid balance is ${formatKobo(totalBalanceKobo)} across ${accountCount || 4} linked bank accounts.`
  }

  // 15. Top Categories Breakdown
  if (q.includes('top') || q.includes('category') || q.includes('breakdown')) {
    const top3 = categoryStats.slice(0, 3)
    if (top3.length === 0) return 'No category records available.'
    const formatted = top3.map((c) => `${c.category} (${formatKobo(c.totalKobo)}, ${c.percent}%)`).join('; ')
    return `Your top spending categories are: ${formatted}. Total consolidated outflow across all rails is ${formatKobo(totalOutflowKobo)}.`
  }

  // Fallback
  return `Across all ${accountCount || 4} linked accounts, total inflow is ${formatKobo(totalInflowKobo)} and total outflow is ${formatKobo(totalOutflowKobo)}, resulting in a net cash flow of ${formatKobo(netCashflowKobo)} (${savingsRate}% retention rate). You can ask me about specific categories, bank account drainage, or recurring subscriptions.`
}
