import { useState } from 'react'
import type { BankCard } from '../../api/types'
import { computeRunway } from '../../lib/runway'
import { Card, cx } from '../ui'
import { BankDistributionSlide } from './BankDistributionSlide'
import { RunwaySlide } from './RunwaySlide'

interface Props {
  bankCards: BankCard[]
  totalKobo: number
}

const SLIDES = [
  { label: 'Where Your Money Is', dot: 'bg-orange-400', aria: 'Show Where Your Money Is' },
  { label: 'How Long Your Money Lasts', dot: 'bg-emerald-400', aria: 'Show How Long Your Money Lasts' },
] as const

const arrowButton =
  'flex size-7 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors'

/** Two charts in a sliding card. The person switches between them with the tabs, arrows or dots. */
export function BreakdownCarousel({ bankCards, totalKobo }: Props) {
  const [activeSlide, setActiveSlide] = useState<0 | 1>(0)
  const runway = computeRunway(totalKobo)

  const toggle = () => setActiveSlide((prev) => (prev === 0 ? 1 : 0))

  return (
    <Card
      className="flex flex-col rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 overflow-hidden"
    >
      {/* Header Controls: Tab Sliders & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 self-start sm:self-auto">
          {SLIDES.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setActiveSlide(i as 0 | 1)}
              className={cx(
                'flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-bold transition-all',
                activeSlide === i
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
              )}
            >
              <span className={cx('size-2 rounded-full', s.dot)} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {activeSlide === 0 ? '100% Synced' : `${runway.runwayDays} Days Safe`}
          </span>

          {/* Slider Arrows */}
          <div className="flex items-center gap-1">
            <button type="button" onClick={toggle} title="Previous chart" aria-label="Previous chart" className={arrowButton}>
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button type="button" onClick={toggle} title="Next chart" aria-label="Next chart" className={arrowButton}>
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Carousel Slider Body */}
      <div className="@container flex flex-1 items-center overflow-hidden pt-5 pb-3">
        <div
          className="flex w-full transition-transform duration-500 ease-in-out motion-reduce:transition-none"
          style={{ transform: `translateX(-${activeSlide * 100}%)` }}
        >
          <BankDistributionSlide bankCards={bankCards} totalKobo={totalKobo} />
          <RunwaySlide runway={runway} />
        </div>
      </div>

      {/* Bottom Slider Dots & Interval Indicator */}
      <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="text-[11px] font-medium">
          {activeSlide + 1} of {SLIDES.length}
        </span>

        <div className="flex items-center gap-2">
          {SLIDES.map((s, i) => (
            <button
              key={s.aria}
              type="button"
              onClick={() => setActiveSlide(i as 0 | 1)}
              aria-label={s.aria}
              className={cx(
                'h-1.5 rounded-full transition-all duration-300',
                activeSlide === i ? 'w-6 bg-teal-600' : 'w-2 bg-slate-300 dark:bg-slate-700 hover:bg-slate-400',
              )}
            />
          ))}
        </div>
      </div>
    </Card>
  )
}
