import { useEffect, useState, type ReactNode } from 'react'
import { ThemeContext } from './useTheme'

function getInitialDark(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const saved = localStorage.getItem('apapo_theme')
    if (saved === 'dark') return true
    if (saved === 'light') return false
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  } catch {
    return false
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState<boolean>(getInitialDark)

  useEffect(() => {
    try {
      if (isDark) {
        document.documentElement.classList.add('dark')
        localStorage.setItem('apapo_theme', 'dark')
      } else {
        document.documentElement.classList.remove('dark')
        localStorage.setItem('apapo_theme', 'light')
      }
    } catch {
      // Safe fallback if local storage is restricted
    }
  }, [isDark])

  const toggleTheme = () => setIsDark((prev) => !prev)
  const setTheme = (dark: boolean) => setIsDark(dark)

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
