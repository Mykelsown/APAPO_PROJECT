import { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useTheme } from '../context/useTheme'
import { useBalancePrivacy } from '../context/useBalancePrivacy'
import { DemoWalkthroughModal } from './demo/DemoWalkthroughModal'
import { ErrorBoundary } from './ErrorBoundary'
import { PageFallback } from './PageFallback'
import { cx } from './ui'

interface NavItemDef {
  to: string
  label: string
  shortLabel: string
  icon: (active: boolean) => React.ReactNode
}

const navItems: NavItemDef[] = [
  {
    to: '/',
    label: 'Dashboard',
    shortLabel: 'Home',
    icon: (active) => (
      <svg className="size-4" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    to: '/pay',
    label: 'Split-Pay',
    shortLabel: 'Pay',
    icon: (active) => (
      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" />
      </svg>
    ),
  },
  {
    to: '/aggregator',
    label: 'Aggregator',
    shortLabel: 'Aggregator',
    icon: (active) => (
      <svg className="size-4" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
  {
    to: '/receive',
    label: 'Split-Receive',
    shortLabel: 'Receive',
    icon: (active) => (
      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 4.5-15 15m0 0h11.25m-11.25 0V8.25" />
      </svg>
    ),
  },
  {
    to: '/banks',
    label: 'Linked Banks',
    shortLabel: 'Banks',
    icon: (active) => (
      <svg className="size-4" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.5M4.5 21V10.5" />
      </svg>
    ),
  },
  {
    to: '/security',
    label: 'Security',
    shortLabel: 'Security',
    icon: (active) => (
      <svg className="size-4" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
  },
]

// The pitch-script walkthrough is hidden for now. Flip this to bring the button and modal back.
const SHOW_DEMO_SCRIPT = false

export function Layout() {
  const nav = useNavigate()
  const { isAuthenticated, logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const { hideBalance, toggleHideBalance } = useBalancePrivacy()
  const [showDemoModal, setShowDemoModal] = useState(false)
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 transition-colors duration-200 dark:bg-slate-950 dark:text-slate-100">
      {!isOnline && (
        <div role="status" className="bg-amber-600 px-4 py-1.5 text-center text-xs font-semibold text-white">
          Network offline. Apapo will automatically reconnect when your network is restored.
        </div>
      )}

      {/* TOP NAVBAR (Web on desktop, compact on mobile) */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo & Platform Info */}
          <div className="flex min-w-0 items-center gap-4 lg:gap-6">
            <Link to="/" className="flex items-center gap-3 group">
              <span className="flex size-9.5 items-center justify-center rounded-2xl bg-teal-700 font-bold text-white group-hover:bg-teal-800 transition-colors">
                A
              </span>
              <div>
                <span className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">
                  Apapo<span className="text-teal-700 dark:text-teal-400">.</span>
                </span>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <nav aria-label="Desktop Primary" className="hidden md:flex md:items-center md:gap-1">
              {navItems.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === '/'}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-xs font-bold transition-all lg:px-3',
                      isActive
                        ? 'bg-teal-700 text-white'
                        : isDark
                          ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className="hidden xl:inline-flex">{n.icon(isActive)}</span>
                      <span>{n.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Right side controls */}
          <div className="flex items-center gap-2.5">
            <Link
              to="/demo"
              className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-bold text-teal-800 transition-all hover:bg-teal-100 dark:border-teal-800/80 dark:bg-teal-950/60 dark:text-teal-300 dark:hover:bg-teal-900"
            >
              <span className="size-2 rounded-full bg-teal-600 animate-pulse" />
              <span>Demo</span>
            </Link>

            {/* BALANCE PRIVACY TOGGLE BUTTON */}
            <button
              type="button"
              onClick={toggleHideBalance}
              aria-label={hideBalance ? 'Disable privacy mode' : 'Enable privacy mode'}
              className="flex size-10 sm:size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              title={hideBalance ? 'Disable privacy mode' : 'Enable privacy mode'}
            >
              {hideBalance ? (
                <svg className="size-4 text-teal-700 dark:text-teal-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg className="size-4 text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              )}
            </button>

            {/* DARK MODE TOGGLE BUTTON */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex size-10 sm:size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? (
                <svg className="size-4 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                </svg>
              ) : (
                <svg className="size-4 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
                </svg>
              )}
            </button>

            {isAuthenticated ? (
              <button
                type="button"
                onClick={async () => {
                  await logout()
                  nav('/login')
                }}
                className="text-xs font-bold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-pointer"
              >
                Sign out
              </button>
            ) : (
              <Link
                to="/login"
                className="rounded-xl bg-teal-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-teal-800"
              >
                Log in
              </Link>
            )}

            <Link
              to="/pay"
              className="hidden items-center justify-center gap-1 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-800 sm:inline-flex"
            >
              <span>+ Split-Pay</span>
            </Link>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER (Responsive full web grid with mobile padding) */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 pb-24 md:pb-12">
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* MOBILE BOTTOM NAVIGATION BAR (Hidden on desktop md:) */}
      <nav
        aria-label="Mobile Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 pb-[env(safe-area-inset-bottom)] md:hidden transition-colors"
      >
        <div className="flex h-15 items-center justify-around px-2">
          {navItems.slice(0, 5).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex flex-1 flex-col items-center justify-center py-1.5 transition-all text-[10px] font-bold gap-0.5',
                  isActive
                    ? 'text-teal-700 dark:text-teal-400 font-extrabold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div
                    className={cx(
                      'p-1 rounded-xl transition-colors',
                      isActive
                        ? 'bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400'
                        : 'text-slate-600 dark:text-slate-400',
                    )}
                  >
                    {n.icon(isActive)}
                  </div>
                  <span>{n.shortLabel}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Pitch script guide modal */}
      {SHOW_DEMO_SCRIPT && <DemoWalkthroughModal open={showDemoModal} onClose={() => setShowDemoModal(false)} />}
    </div>
  )
}
