import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { ToastProvider } from '../components/ui'
import { AuthProvider } from '../context/AuthContext'
import { BalancePrivacyProvider } from '../context/BalancePrivacyContext'
import { ThemeProvider } from '../context/ThemeContext'

/** Renders the whole app, with the same providers as main.tsx, at the given route. */
export function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <BalancePrivacyProvider>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </BalancePrivacyProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

export const SLOW = { timeout: 20_000 }
