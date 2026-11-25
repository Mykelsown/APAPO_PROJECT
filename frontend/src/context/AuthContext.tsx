import { useState, type ReactNode } from 'react'
import { api, apiMode } from '../api/client'
import { session } from '../api/session'
import { AuthContext } from './useAuth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    const existing = session.get()
    if (existing) return existing
    if (
      typeof window !== 'undefined' &&
      (window.location.pathname.includes('login') ||
        window.location.pathname.includes('signin') ||
        window.location.pathname.includes('onboarding'))
    ) {
      return null
    }
    if (apiMode === 'mock') {
      session.set('mock-token')
      return 'mock-token'
    }
    return null
  })

  async function login(phone: string, pin: string) {
    const res = await api.auth.login({ phone, pin })
    session.set(res.token)
    setToken(res.token)
  }

  function completeOnboarding(newToken: string) {
    session.set(newToken)
    setToken(newToken)
  }

  async function logout() {
    try {
      await api.auth.logout()
    } finally {
      session.clear()
      setToken(null)
    }
  }

  function demoLogin() {
    session.set('mock-token')
    setToken('mock-token')
  }

  return (
    <AuthContext.Provider
      value={{
        token,
        isAuthenticated: Boolean(token),
        login,
        completeOnboarding,
        logout,
        demoLogin,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
