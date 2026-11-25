import { createContext, useContext } from 'react'

export interface BalancePrivacyContextValue {
  hideBalance: boolean
  toggleHideBalance: () => void
  setHideBalance: (hide: boolean) => void
}

export const BalancePrivacyContext = createContext<BalancePrivacyContextValue>({
  hideBalance: false,
  toggleHideBalance: () => {},
  setHideBalance: () => {},
})

export function useBalancePrivacy() {
  return useContext(BalancePrivacyContext)
}
