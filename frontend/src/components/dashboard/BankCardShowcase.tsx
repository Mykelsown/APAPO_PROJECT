import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Account, BankCard as BankCardData } from '../../api/types'
import { useBalancePrivacy } from '../../context/useBalancePrivacy'
import { formatKobo } from '../../lib/money'
import { Badge, cx } from '../ui'

interface Props {
  cards: BankCardData[]
  accounts?: Account[]
}

interface BankTheme {
  bgColor: string
  borderColor: string
  accentColor: string
  badgeBg: string
  tag: string
  logoText: string
  ringColor: string
}

const bankThemes: Record<string, BankTheme> = {
  'Access Bank': {
    bgColor: 'bg-[#003865]',
    borderColor: 'border-[#004d8c]',
    accentColor: 'text-[#F37023]',
    badgeBg: 'bg-[#F37023]',
    tag: 'Access Direct',
    logoText: 'ACCESS',
    ringColor: 'ring-[#F37023]',
  },
  GTBank: {
    bgColor: 'bg-[#E05A10]',
    borderColor: 'border-[#b84305]',
    accentColor: 'text-white',
    badgeBg: 'bg-black/25',
    tag: 'GT Connect',
    logoText: 'GTBANK',
    ringColor: 'ring-[#E05A10]',
  },
  'Zenith Bank': {
    bgColor: 'bg-[#D2232A]',
    borderColor: 'border-[#a8141a]',
    accentColor: 'text-white',
    badgeBg: 'bg-black/25',
    tag: 'Zenith Direct',
    logoText: 'ZENITH',
    ringColor: 'ring-[#D2232A]',
  },
  UBA: {
    bgColor: 'bg-[#BA0C12]',
    borderColor: 'border-[#8f090e]',
    accentColor: 'text-white',
    badgeBg: 'bg-black/25',
    tag: 'UBA Global',
    logoText: 'UBA',
    ringColor: 'ring-[#BA0C12]',
  },
  'Kuda Bank': {
    bgColor: 'bg-[#40196D]',
    borderColor: 'border-[#2d0f50]',
    accentColor: 'text-white',
    badgeBg: 'bg-black/25',
    tag: 'Kuda Vault',
    logoText: 'KUDA',
    ringColor: 'ring-[#40196D]',
  },
  'First Bank': {
    bgColor: 'bg-[#002B49]',
    borderColor: 'border-[#001e33]',
    accentColor: 'text-[#F2C037]',
    badgeBg: 'bg-[#F2C037] text-slate-900',
    tag: 'First Direct',
    logoText: 'FIRSTBANK',
    ringColor: 'ring-[#F2C037]',
  },
  'Apex Bank': {
    bgColor: 'bg-[#0f4c5c]',
    borderColor: 'border-[#0a323d]',
    accentColor: 'text-[#fb8500]',
    badgeBg: 'bg-[#fb8500] text-slate-900',
    tag: 'Apex Direct',
    logoText: 'APEX',
    ringColor: 'ring-[#fb8500]',
  },
  'Delta Trust Bank': {
    bgColor: 'bg-[#1d3557]',
    borderColor: 'border-[#112238]',
    accentColor: 'text-[#48cae4]',
    badgeBg: 'bg-[#48cae4] text-slate-900',
    tag: 'Delta Vault',
    logoText: 'DELTA',
    ringColor: 'ring-[#48cae4]',
  },
  'Savanna Bank': {
    bgColor: 'bg-[#b05817]',
    borderColor: 'border-[#8f440d]',
    accentColor: 'text-[#ffe8d6]',
    badgeBg: 'bg-black/25',
    tag: 'Savanna Rail',
    logoText: 'SAVANNA',
    ringColor: 'ring-[#b05817]',
  },
  'Harbor MFB': {
    bgColor: 'bg-[#28536b]',
    borderColor: 'border-[#1b3a4b]',
    accentColor: 'text-[#90e0ef]',
    badgeBg: 'bg-black/25',
    tag: 'Harbor MFB',
    logoText: 'HARBOR',
    ringColor: 'ring-[#28536b]',
  },
}

const defaultTheme: BankTheme = {
  bgColor: 'bg-[#0f766e]',
  borderColor: 'border-[#115e59]',
  accentColor: 'text-teal-200',
  badgeBg: 'bg-black/25',
  tag: 'Open Rail',
  logoText: 'BANK',
  ringColor: 'ring-teal-500',
}

/** Short balance for the small thumbnails, for example ₦185k. The full amount is in the tooltip. */
function compactNaira(kobo: number): string {
  const naira = Math.round(kobo / 100)
  if (naira >= 1_000_000) return `₦${+(naira / 1_000_000).toFixed(1)}M`
  if (naira >= 1_000) return `₦${+(naira / 1_000).toFixed(1)}k`
  return `₦${naira}`
}

export function BankCardShowcase({ cards, accounts = [] }: Props) {
  const { hideBalance } = useBalancePrivacy()
  const [activeBankIndex, setActiveBankIndex] = useState(0)
  const [isFlipping, setIsFlipping] = useState(false)
  const [isBack, setIsBack] = useState(false)

  const count = cards.length
  const currentCard = cards[activeBankIndex] ?? cards[0]
  const currentAccount = accounts.find((a) => a.bank_name === currentCard?.bank_name)
  const theme = currentCard ? (bankThemes[currentCard.bank_name] ?? defaultTheme) : defaultTheme
  const masked = currentAccount?.masked_number ?? '•••• 0000'

  function triggerCardFlip(targetIndex: number) {
    if (targetIndex === activeBankIndex || isFlipping || count <= 1) return
    setIsFlipping(true)
    setTimeout(() => {
      setActiveBankIndex(targetIndex)
      setIsBack(false)
    }, 250)
    setTimeout(() => {
      setIsFlipping(false)
    }, 500)
  }

  function handleNext() {
    if (isFlipping || count <= 1) return
    const next = (activeBankIndex + 1) % count
    triggerCardFlip(next)
  }

  function handlePrev() {
    if (isFlipping || count <= 1) return
    const prev = (activeBankIndex - 1 + count) % count
    triggerCardFlip(prev)
  }

  function toggleFlipSide() {
    if (isFlipping) return
    setIsBack((prev) => !prev)
  }

  if (!currentCard) return null

  return (
    <div
      className="@container rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-3"
    >
      <style>{`
        @keyframes apapoCardFlip {
          0% {
            transform: perspective(1200px) rotateY(0deg) scale(1);
          }
          50% {
            transform: perspective(1200px) rotateY(90deg) scale(0.92);
            opacity: 0.8;
          }
          100% {
            transform: perspective(1200px) rotateY(0deg) scale(1);
            opacity: 1;
          }
        }
        .animate-card-flip {
          animation: apapoCardFlip 500ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
      `}</style>

      {/* HEADER: Title, Counter, Flip Next/Prev & Manage Link */}
      <div className="flex flex-col @2xl:flex-row @2xl:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white whitespace-nowrap">Connected Accounts</h2>
            <span className="whitespace-nowrap rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300">
              Card {activeBankIndex + 1} of {count}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">
            Your connected banks and real-time balances
          </p>
        </div>

        <div className="flex items-center justify-between @2xl:justify-end gap-3 w-full @2xl:w-auto">

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrev}
              title="Previous bank card"
              aria-label="Previous bank card"
              className="flex size-7 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleNext}
              title="Next bank card"
              aria-label="Next bank card"
              className="flex size-7 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>

          <Link
            to="/banks"
            className="whitespace-nowrap text-xs font-bold text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 transition-colors"
          >
            Manage accounts →
          </Link>
        </div>
      </div>

      {/* 3D FLIP SHOWCASE CARD */}
      <div className="flex justify-center">
        <div
          style={{ perspective: '1200px' }}
          className="w-full max-w-[19rem] aspect-[1.586/1] min-h-[176px]"
        >
          <div
            onClick={toggleFlipSide}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === '') {
                e.preventDefault()
                toggleFlipSide()
              }
            }}
            aria-label={`Flip ${currentCard.bank_name} card details`}
            title="Click card to flip front/back"
            style={{
              transformStyle: 'preserve-3d',
              transform: isBack ? 'rotateY(180deg)' : 'rotateY(0deg)',
              transition: 'transform 600ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            className={cx(
              'relative size-full rounded-2xl cursor-pointer motion-reduce:transition-none focus:outline-hidden focus:ring-2 focus:ring-teal-400',
              isFlipping && 'animate-card-flip motion-reduce:animate-none',
            )}
          >
            {/* FRONT FACE */}
            <div
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
              }}
              className={cx(
                'absolute inset-0 flex flex-col justify-between rounded-2xl p-4 text-white border',
                currentCard.unavailable
                  ? 'bg-slate-800 border-slate-700 opacity-80'
                  : `${theme.bgColor} ${theme.borderColor}`,
              )}
            >
              {/* Top Row: Bank identity & Contactless icon & Flip pill */}
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className={cx('text-xs sm:text-sm font-bold tracking-normal uppercase', theme.accentColor)}>
                      {currentCard.bank_name}
                    </span>
                  </div>
                  <span className="text-[10px] font-medium text-white/70 tracking-wider uppercase">
                    {theme.tag}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {currentCard.unavailable ? (
                    <Badge tone="amber">Unavailable</Badge>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 text-white/75" title="Open Banking Contactless Rail">
                        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path strokeLinecap="round" d="M8.5 16.5a5 5 0 0 1 0-7" />
                          <path strokeLinecap="round" d="M12 19a8.5 8.5 0 0 0 0-14" />
                          <path strokeLinecap="round" d="M15.5 21.5a12 12 0 0 0 0-21" />
                        </svg>
                      </div>
                      <span
                        className="rounded-full bg-black/25 hover:bg-black border border-white/20 px-2.5 py-0.5 text-[10px] font-bold text-white transition-colors flex items-center gap-1"
                      >
                        <span>Flip Details</span>
                        <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                        </svg>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Middle: Solid EMV Microchip Graphic & Masked Number */}
              <div className="flex items-center justify-between">
                <div
                  aria-hidden="true"
                  className="relative h-7 w-9 rounded-md bg-amber-400 border border-amber-500 p-0.5"
                >
                  <div className="size-full rounded-[3px] border border-amber-600 bg-amber-300 flex items-center justify-center">
                    <div className="h-full w-px bg-amber-700" />
                    <div className="w-full h-px bg-amber-700 absolute" />
                  </div>
                </div>

                <span className="font-mono text-xs tracking-widest text-white/90 font-bold">
                  {masked}
                </span>
              </div>

              {/* Bottom Row: Balance & Status */}
              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] font-medium text-white/70">
                    Available Balance
                  </span>
                  <span className="text-[10px] font-mono text-emerald-300 font-medium flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    Verified & Active
                  </span>
                </div>

                {currentCard.unavailable ? (
                  <p className="text-xs text-amber-200 font-medium">Bank rail offline. Reconnecting...</p>
                ) : (
                  <p className="text-xl font-bold tabular-nums text-white">
                    {formatKobo(currentCard.balance_kobo, hideBalance)}
                  </p>
                )}
              </div>
            </div>

            {/* BACK FACE */}
            <div
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
              className={cx(
                'absolute inset-0 flex flex-col justify-between rounded-2xl py-4 sm:py-5 text-white border overflow-hidden',
                currentCard.unavailable
                  ? 'bg-slate-800 border-slate-700 opacity-80'
                  : `${theme.bgColor} ${theme.borderColor}`,
              )}
            >
              {/* Magnetic Stripe */}
              <div className="h-9 sm:h-10 bg-slate-950 w-full border-y border-black" />

              {/* Signature Panel & Details */}
              <div className="px-5 sm:px-6 space-y-2">
                <div className="bg-slate-100 rounded-sm px-3 py-1.5 flex items-center justify-between text-slate-800 text-[11px] font-mono">
                  <span className="italic text-[10px] text-slate-500 font-sans">Authorized Signature</span>
                  <span className="font-bold tracking-widest">CVV •••</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-white/80 pt-1">
                  <div>
                    <span className="text-[10px] font-medium text-white/70 block">Account ID</span>
                    <span className="font-mono font-bold text-white">{currentAccount?.account_id ?? 'ACCT-LINKED'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-white/70 block">Settlement Rail</span>
                    <span className="font-semibold text-white">NIBSS / Instant Rail</span>
                  </div>
                </div>
              </div>

              {/* Back Bottom */}
              <div className="px-5 sm:px-6 flex items-center justify-between text-[10px] text-white/70 border-t border-white/10 pt-2">
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span>Open Banking Consent Active</span>
                </div>

                <span
                  className="rounded-full bg-black/25 hover:bg-black border border-white/20 px-2.5 py-0.5 text-[10px] font-bold text-white transition-colors flex items-center gap-1"
                >
                  <span>Flip to Front</span>
                  <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* THUMBNAILS FOR EACH CONNECTED CARD BELOW */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
          <span>All Linked Bank Accounts</span>
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Tap thumbnail to flip card
          </span>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {cards.map((c, idx) => {
            const isActive = idx === activeBankIndex
            const t = bankThemes[c.bank_name] ?? defaultTheme

            return (
              <button
                key={c.bank_name}
                type="button"
                onClick={() => triggerCardFlip(idx)}
                aria-label={`Select ${c.bank_name} card`}
                title={hideBalance ? c.bank_name : `${c.bank_name}: ${formatKobo(c.balance_kobo)}`}
                className={cx(
                  'group relative flex size-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg p-1 text-center transition-all duration-200 text-white cursor-pointer overflow-hidden',
                  t.bgColor,
                  isActive
                    ? 'opacity-100 scale-[1.02]'
                    : 'opacity-55 hover:opacity-90 hover:scale-[1.01]',
                )}
              >
                <span className={cx('w-full truncate text-[9px] font-bold tracking-normal uppercase', t.accentColor)}>
                  {c.bank_name.split('')[0]}
                </span>
                <span className="w-full truncate text-[10px] font-bold tabular-nums text-white">
                  {hideBalance ? '••••' : compactNaira(c.balance_kobo)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
