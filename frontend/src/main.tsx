import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { bootstrapSession } from './api/bootstrap'
import { ToastProvider } from './components/ui'
import { AuthProvider } from './context/AuthContext'
import { BalancePrivacyProvider } from './context/BalancePrivacyContext'
import { ThemeProvider } from './context/ThemeContext'
import './index.css'

bootstrapSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <BalancePrivacyProvider>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </BalancePrivacyProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
