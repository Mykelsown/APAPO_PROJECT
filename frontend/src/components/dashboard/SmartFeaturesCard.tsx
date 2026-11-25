import { Link } from 'react-router-dom'
import { Card } from '../ui'

const FEATURES = [
  {
    to: '/pay',
    title: 'Split-Pay with Rollback',
    body: 'Combines balances from multiple accounts in one tap. Reverses earlier legs if any step fails.',
    icon: (
      <svg className="size-4 text-teal-600 dark:text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" />
      </svg>
    ),
  },
  {
    to: '/receive',
    title: 'Split-Receive & Settlement',
    body: 'Automatically splits incoming money into your chosen savings and bank accounts.',
    icon: (
      <svg className="size-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 4.5-15 15m0 0h11.25m-11.25 0V8.25" />
      </svg>
    ),
  },
  {
    to: '/banks',
    title: 'Open Banking Consent',
    body: 'Safe, bank-approved connections. You can disconnect any bank at any time.',
    icon: (
      <svg className="size-4 text-sky-600 dark:text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.5M4.5 21V10.5" />
      </svg>
    ),
  },
]

/** Desktop sidebar shortcuts to the three product areas. */
export function SmartFeaturesCard() {
  return (
    <Card className="space-y-4 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Smart Payment Features
        </h3>
        <span className="size-2 rounded-full bg-emerald-500" />
      </div>

      <div className="space-y-3 text-xs">
        {FEATURES.map((f) => (
          <Link
            key={f.to}
            to={f.to}
            className="block rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
              <span className="shrink-0">{f.icon}</span>
              <span>{f.title}</span>
            </div>
            <p className="mt-1 text-slate-600 dark:text-slate-300 leading-relaxed font-medium">{f.body}</p>
          </Link>
        ))}
      </div>
    </Card>
  )
}
