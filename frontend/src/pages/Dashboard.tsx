import { useState } from 'react'
import { api } from '../api/client'
import type { FeedRow } from '../api/types'
import { ActivityFeed } from '../components/dashboard/ActivityFeed'
import { BalanceHero } from '../components/dashboard/BalanceHero'
import { BankCardShowcase } from '../components/dashboard/BankCardShowcase'
import { BreakdownCarousel } from '../components/dashboard/BreakdownCarousel'
import { CategoryOverrideModal } from '../components/dashboard/CategoryOverrideModal'
import { InsightsSlot } from '../components/dashboard/InsightsSlot'
import { SmartFeaturesCard } from '../components/dashboard/SmartFeaturesCard'
import { usePullToRefresh } from '../components/dashboard/usePullToRefresh'
import { ErrorState } from '../components/ErrorState'
import { ScamShieldModal } from '../components/safesend/ScamShieldModal'
import { Skeleton } from '../components/ui'
import { useAsync } from '../lib/useAsync'

export function Dashboard() {
  const { data, error, loading, reload } = useAsync(async () => {
    const [dash, accts] = await Promise.all([api.dashboard.get(), api.accounts.list()])
    return { dash, accounts: accts.accounts }
  })
  const { pull, ready } = usePullToRefresh(reload)

  const [shieldRow, setShieldRow] = useState<FeedRow | null>(null)
  const [editingCategoryRow, setEditingCategoryRow] = useState<FeedRow | null>(null)

  if (!data && loading) return <DashboardSkeleton />
  if (!data && error) {
    return (
      <div className="mt-4">
        <ErrorState error={error} onRetry={reload} />
      </div>
    )
  }
  if (!data) return null

  const { dash, accounts } = data
  const showBreakdown =
    dash.bank_cards.some((c) => !c.unavailable && c.balance_kobo > 0) || dash.total_balance_kobo > 0

  return (
    <div className="space-y-8 pt-1">
      {/* Pull to refresh indicator on touch screens */}
      <div
        aria-hidden={pull === 0}
        className="-mb-2 flex h-0 items-end justify-center overflow-visible text-xs font-semibold text-slate-700 dark:text-slate-300"
        style={{ height: pull }}
      >
        {pull > 0 && (ready ? 'Release to refresh' : 'Pull to refresh')}
      </div>

      <BalanceHero
        totalKobo={dash.total_balance_kobo}
        bankCount={dash.bank_cards.length}
        anyDown={dash.bank_cards.some((c) => c.unavailable)}
        loading={loading}
        error={error}
        onSync={reload}
      />

      {/* Breakdown charts and the connected-accounts showcase sit side by side on large screens */}
      <div className="grid gap-8 lg:grid-cols-2 lg:items-stretch">
        {showBreakdown && <BreakdownCarousel bankCards={dash.bank_cards} totalKobo={dash.total_balance_kobo} />}

        <section aria-label="Your banks" className={`min-w-0 [&>div]:h-full ${showBreakdown ? '' : 'lg:col-span-2'}`}>
          <BankCardShowcase cards={dash.bank_cards} accounts={accounts} />
        </section>
      </div>

      {/* Mobile-only insights card */}
      <div className="lg:hidden">
        <InsightsSlot feed={dash.transaction_feed} />
      </div>

      {/* Two columns on desktop: activity feed and sidebar */}
      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
        <ActivityFeed
          transactions={dash.transaction_feed}
          bankNames={dash.bank_cards.map((c) => c.bank_name)}
          onOpenShield={setShieldRow}
          onEditCategory={setEditingCategoryRow}
        />

        <aside className="hidden space-y-6 lg:col-span-4 lg:block">
          <InsightsSlot feed={dash.transaction_feed} />
          <SmartFeaturesCard />
        </aside>
      </div>

      <ScamShieldModal
        open={Boolean(shieldRow)}
        creditId={shieldRow?.id}
        amountKobo={shieldRow?.amount_kobo}
        counterparty={shieldRow?.counterparty}
        onClose={() => setShieldRow(null)}
      />

      <CategoryOverrideModal
        open={Boolean(editingCategoryRow)}
        row={editingCategoryRow}
        onClose={() => setEditingCategoryRow(null)}
        onSuccess={reload}
      />
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 pt-2" aria-busy="true" aria-label="Loading your accounts">
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  )
}
