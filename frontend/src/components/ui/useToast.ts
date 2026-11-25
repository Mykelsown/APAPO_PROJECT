import { createContext, useContext } from 'react'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastApi {
  show: (text: string, kind?: ToastKind) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
