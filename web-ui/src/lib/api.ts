import type { DiscussionMessageRecord, ListResult, ReviewRecord, SessionRecord } from '@/lib/types'

const apiBaseUrl = (() => {
  const env = process.env.NEXT_PUBLIC_ARGOS_API_BASE_URL
  if (env) {
    return env
  }

  // If running in the browser, derive API host from current page host
  if (typeof window !== 'undefined' && window.location) {
    const proto = window.location.protocol
    const host = window.location.hostname
    // API listens on port 3001 by default
    return `${proto}//${host}:3001`
  }

  // Fallback for server-side / build-time
  return 'http://localhost:3001'
})()

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    cache: 'no-store',
  })

  if (!response.ok) {
    let message = `request failed with status ${response.status}`
    try {
      const data = (await response.json()) as { message?: string }
      if (typeof data.message === 'string') {
        message = data.message
      }
    } catch {
      // ignore json parse failures
    }
    throw new ApiError(response.status, message)
  }

  return (await response.json()) as T
}

async function requestWithMethod<T>(path: string, method: 'DELETE'): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    cache: 'no-store',
  })

  if (!response.ok) {
    let message = `request failed with status ${response.status}`
    try {
      const data = (await response.json()) as { message?: string }
      if (typeof data.message === 'string') {
        message = data.message
      }
    } catch {
      // ignore json parse failures
    }
    throw new ApiError(response.status, message)
  }

  return (await response.json()) as T
}

export function getApiBaseUrl(): string {
  return apiBaseUrl
}

export async function fetchReviews(
  options: { limit?: number; offset?: number } = {},
): Promise<ListResult<ReviewRecord>> {
  const searchParams = new URLSearchParams()

  if (typeof options.limit === 'number') {
    searchParams.set('limit', String(options.limit))
  }

  if (typeof options.offset === 'number') {
    searchParams.set('offset', String(options.offset))
  }

  const query = searchParams.toString()
  return requestJson<ListResult<ReviewRecord>>(`/api/reviews${query ? `?${query}` : ''}`)
}

export async function fetchReview(reviewId: string): Promise<ReviewRecord> {
  return requestJson<ReviewRecord>(`/api/reviews/${encodeURIComponent(reviewId)}`)
}

export async function deleteReview(reviewId: string): Promise<{ review_id: string; deleted_sessions: number }> {
  return requestWithMethod<{ review_id: string; deleted_sessions: number }>(
    `/api/reviews/${encodeURIComponent(reviewId)}`,
    'DELETE',
  )
}

export async function fetchSessions(reviewId?: string): Promise<ListResult<SessionRecord>> {
  const query = reviewId ? `?review_id=${encodeURIComponent(reviewId)}` : ''
  return requestJson<ListResult<SessionRecord>>(`/api/sessions${query}`)
}

export async function fetchSession(sessionId: string): Promise<SessionRecord> {
  return requestJson<SessionRecord>(`/api/sessions/${encodeURIComponent(sessionId)}`)
}

export async function fetchSessionMessages(sessionId: string): Promise<{ items: DiscussionMessageRecord[] }> {
  return requestJson<{ items: DiscussionMessageRecord[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`)
}

export { ApiError }
