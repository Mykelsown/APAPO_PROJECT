import { apiMode } from './client'
import { session } from './session'

/**
 * Until onboarding (F1) exists, mock mode starts signed in so protected screens can be built.
 * Real mode never fakes a session.
 */
export function bootstrapSession() {
  if (apiMode === 'mock' && !session.get()) session.set('mock-token')
}
