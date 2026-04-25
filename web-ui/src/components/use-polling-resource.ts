'use client'

import { useEffect, useState } from 'react'

interface PollingState<T> {
  data: T | null
  error: string | null
  isLoading: boolean
}

export function usePollingResource<T>(fetcher: () => Promise<T>, deps: unknown[] = [], intervalMs = 5000) {
  const [state, setState] = useState<PollingState<T>>({
    data: null,
    error: null,
    isLoading: true,
  })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const data = await fetcher()
        if (!cancelled) {
          setState({ data, error: null, isLoading: false })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error'
        if (!cancelled) {
          setState(current => ({ data: current.data, error: message, isLoading: false }))
        }
      }
    }

    void load()
    const timer = window.setInterval(() => {
      void load()
    }, intervalMs)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, deps)

  return state
}
