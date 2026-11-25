import { useEffect, useState, type ReactNode } from 'react'
import { BalancePrivacyContext } from './useBalancePrivacy'

function getInitialHide(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem('apapo_hide_balance') === 'true'
  } catch {
    return false
  }
}

export function BalancePrivacyProvider({ children }: { children: ReactNode }) {
  const [hideBalance, setHideBalanceState] = useState<boolean>(getInitialHide)

  useEffect(() => {
    try {
      localStorage.setItem('apapo_hide_balance', String(hideBalance))
    } catch {
      // Safe fallback if local storage is restricted
    }
  }, [hideBalance])

  const toggleHideBalance = () => setHideBalanceState((prev) => !prev)
  const setHideBalance = (hide: boolean) => setHideBalanceState(hide)

  return (
    <BalancePrivacyContext.Provider value={{ hideBalance, toggleHideBalance, setHideBalance }}>
      {children}
    </BalancePrivacyContext.Provider>
  )
}
