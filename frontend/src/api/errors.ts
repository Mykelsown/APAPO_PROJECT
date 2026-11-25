import type { ApiErrorBody } from './types'

export class ApiError extends Error {
  readonly code: string
  readonly details?: unknown
  readonly status?: number

  constructor(body: ApiErrorBody, status?: number) {
    super(body.message)
    this.name = 'ApiError'
    this.code = body.code
    this.details = body.details
    this.status = status
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  return new ApiError({
    code: 'NETWORK_ERROR',
    message: 'We could not reach Apapo. Check your connection and try again.',
  })
}
