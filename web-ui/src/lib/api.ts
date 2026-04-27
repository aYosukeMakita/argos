import type { DiscussionMessageRecord, ListResult, ReviewRecord, SessionRecord } from '@/lib/types'

const DEFAULT_API_PORT = '3001'

function resolveBrowserApiBaseUrl(): string {
  const url = new URL(window.location.origin)
  url.port = DEFAULT_API_PORT
  return url.origin
}

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
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
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
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
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
  if (typeof window !== 'undefined' && window.location) {
    return resolveBrowserApiBaseUrl()
  }

  const env = process.env.NEXT_PUBLIC_ARGOS_API_BASE_URL
  if (env) {
    return env
  }

  return `http://localhost:${DEFAULT_API_PORT}`
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
