import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Card } from './ui'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled UI error caught by boundary:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined })
    window.location.reload()
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex items-center justify-center p-6 min-h-[300px]">
          <Card role="alert" className="max-w-md w-full p-6 text-center space-y-4 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="size-10 mx-auto rounded-xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-amber-800 dark:text-amber-400">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Something went wrong</h2>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                We encountered an unexpected error while rendering this view.
              </p>
            </div>
            <Button variant="secondary" onClick={this.handleReset} className="w-full">
              Reload Screen
            </Button>
          </Card>
        </div>
      )
    }
    return this.props.children
  }
}
