import { createContext, useContext } from 'react'

export interface ThemeContextValue {
  isDark: boolean
  toggleTheme: () => void
  setTheme: (dark: boolean) => void
}

export const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  toggleTheme: () => {},
  setTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}
