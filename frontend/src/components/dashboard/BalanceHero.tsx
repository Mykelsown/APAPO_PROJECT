import { Link } from 'react-router-dom'
import type { ApiError } from '../../api/errors'
import { useBalancePrivacy } from '../../context/useBalancePrivacy'
import { formatKobo } from '../../lib/money'
import { ErrorState } from '../ErrorState'
import { cx } from '../ui'

interface Props {
  totalKobo: number
  bankCount: number
  anyDown: boolean
  loading: boolean
  error: ApiError | null
  onSync: () => void
}

/** The dark banner: combined balance, hide toggle, sync, and the three main actions. */
export function BalanceHero({ totalKobo, bankCount, anyDown, loading, error, onSync }: Props) {
  const { hideBalance, toggleHideBalance } = useBalancePrivacy()

  return (
    <section
      aria-labelledby="total-label"
      className="relative overflow-hidden rounded-3xl border border-teal-800 bg-[#042f2e] p-6 sm:p-8 text-white"
    >
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex size-2 rounded-full bg-emerald-400" />
            <p id="total-label" className="text-xs font-medium text-white/70">
              Total Combined Balance
            </p>
            <span className="rounded-full bg-teal-900 border border-teal-700 px-2.5 py-0.5 text-[10px] font-semibold text-teal-200">
              {bankCount} Banks Linked
            </span>
          </div>

          <div className="flex items-center gap-4">
            <p className="text-3xl font-bold tabular-nums sm:text-5xl text-white">
              {formatKobo(totalKobo, hideBalance)}
            </p>

            <button
              type="button"
              onClick={toggleHideBalance}
              aria-label={hideBalance ? 'Show balance' : 'Hide balance'}
              className="rounded-xl bg-teal-900 border border-teal-700 p-2 text-white hover:bg-teal-800 transition-colors"
              title={hideBalance ? 'Show balance' : 'Hide balance'}
            >
              {hideBalance ? (
                <svg className="size-4.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg className="size-4.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              )}
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-white/70">
            <span>Combined across all your banks</span>
            <span>·</span>
            <button
              type="button"
              onClick={onSync}
              disabled={loading}
              className="font-semibold text-teal-300 hover:text-teal-200 underline-offset-2 hover:underline disabled:text-white/40 flex items-center gap-1"
            >
              <svg className={cx('size-3', loading && 'animate-spin')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              {loading ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>

          {anyDown && (
            <p role="status" className="mt-2.5 rounded-xl bg-amber-500/20 border border-amber-500 p-2.5 text-xs text-amber-200">
              One bank account is temporarily unavailable. Its balance is omitted from this total.
            </p>
          )}
          {error && (
            <div className="mt-2">
              <ErrorState error={error} onRetry={onSync} />
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/pay"
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-500 px-4 text-xs font-semibold text-white transition-colors sm:flex-none"
          >
            <span>+ Split-Pay</span>
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" />
            </svg>
          </Link>

          <Link
            to="/receive"
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-teal-700 bg-teal-900/90 px-3.5 text-xs font-medium text-white transition-colors hover:bg-teal-800 sm:flex-none"
          >
            <svg className="size-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 4.5-15 15m0 0h11.25m-11.25 0V8.25" />
            </svg>
            <span>Split-Receive</span>
          </Link>

          <Link
            to="/banks"
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-teal-700 bg-teal-900/90 px-3.5 text-xs font-medium text-white transition-colors hover:bg-teal-800 sm:flex-none"
          >
            <svg className="size-3.5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.5M4.5 21V10.5" />
            </svg>
            <span>Link Bank</span>
          </Link>

          <Link
            to="/aggregator"
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-teal-700 bg-teal-900/90 px-3.5 text-xs font-medium text-white transition-colors hover:bg-teal-800 sm:flex-none"
          >
            <svg className="size-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
            <span>Insights</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
