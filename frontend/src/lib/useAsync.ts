import { useCallback, useEffect, useRef, useState } from 'react'
import { toApiError, type ApiError } from '../api/errors'

interface State<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
}

/** Runs an async loader on mount and whenever `reload` is called. Keeps old data while refreshing. */
export function useAsync<T>(loader: () => Promise<T>) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true })
  const loaderRef = useRef(loader)
  useEffect(() => {
    loaderRef.current = loader
  })
  const runId = useRef(0)

  const load = useCallback(async () => {
    const id = ++runId.current
    try {
      const data = await loaderRef.current()
      if (id === runId.current) setState({ data, error: null, loading: false })
    } catch (e) {
      if (id === runId.current) setState((s) => ({ data: s.data, error: toApiError(e), loading: false }))
    }
  }, [])

  // The first load starts as loading already; only later reloads need to flip the flag.
  const reload = useCallback(() => {
    setState((s) => ({ ...s, error: null, loading: true }))
    return load()
  }, [load])

  useEffect(() => {
    const counter = runId
    void load()
    return () => {
      counter.current++
    }
  }, [load])

  return { ...state, reload }
}
