import { useEffect, useRef, useState } from 'react'

const THRESHOLD = 70

/** Touch pull-down at the top of the page. Returns the current pull distance. */
export function usePullToRefresh(onRefresh: () => Promise<unknown> | void) {
  const [pull, setPull] = useState(0)
  const start = useRef<number | null>(null)
  const distance = useRef(0)
  const cb = useRef(onRefresh)
  useEffect(() => {
    cb.current = onRefresh
  })

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 ? e.touches[0].clientY : null
    }
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return
      const dy = e.touches[0].clientY - start.current
      distance.current = dy > 0 ? Math.min(dy * 0.5, THRESHOLD * 1.5) : 0
      setPull(distance.current)
    }
    const onEnd = () => {
      if (distance.current >= THRESHOLD) void cb.current()
      distance.current = 0
      setPull(0)
      start.current = null
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [])

  return { pull, ready: pull >= THRESHOLD }
}
