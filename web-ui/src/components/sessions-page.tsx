'use client'

import Link from 'next/link'
import { fetchSessions } from '@/lib/api'
import type { SessionRecord } from '@/lib/types'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { usePollingResource } from '@/components/use-polling-resource'

function actorLabel(actor: SessionRecord['next_actor'] | SessionRecord['examiner']): string {
  if (actor === 'EXAMINER') {
    return 'Examiner'
  }

  if (actor === 'REVIEWER') {
    return 'Reviewer'
  }

  return actor ?? '-'
}

function examinerLabel(session: SessionRecord): string {
  return session.examiner_model_name ?? actorLabel(session.examiner)
}

export function SessionsPage({ reviewId }: { reviewId?: string }) {
  const sessionsState = usePollingResource(() => fetchSessions(reviewId), [reviewId ?? 'all'])

  if (sessionsState.isLoading && !sessionsState.data) {
    return <LoadingState label="セッション一覧を読み込み中です。" />
  }

  if (sessionsState.error && !sessionsState.data) {
    return <ErrorState message={sessionsState.error} />
  }

  const sessions = sessionsState.data?.items ?? []
  if (sessions.length === 0) {
    return (
      <EmptyState title="セッションはまだありません" description="start_session が呼ばれるとここに表示されます。" />
    )
  }

  return (
    <section className="stack-grid session-list">
      {sessions.map(session => (
        <article className="panel-card session-card" key={session.id}>
          <div className="card-header">
            <div>
              <p className="card-label">Session</p>
              <h2>{session.id}</h2>
            </div>
            <div className="badge-stack">
              <StatusBadge tone={session.status === 'finished' ? 'success' : 'warning'}>{session.status}</StatusBadge>
              <StatusBadge tone={session.final_judgment === 'NG' ? 'danger' : 'neutral'}>
                {session.final_judgment ?? 'pending'}
              </StatusBadge>
            </div>
          </div>
          <div className="session-meta-grid">
            <div>
              <span className="meta-label">Review</span>
              <strong>{session.review_id}</strong>
            </div>
            <div>
              <span className="meta-label">Examiner</span>
              <strong>{examinerLabel(session)}</strong>
            </div>
            <div>
              <span className="meta-label">Current Round</span>
              <strong>{session.current_round}</strong>
            </div>
            <div>
              <span className="meta-label">Next Actor</span>
              <strong>{actorLabel(session.next_actor)}</strong>
            </div>
          </div>
          <div className="action-row">
            <Link href={`/sessions/${session.id}`}>セッション詳細</Link>
            <Link href={`/reviews/${session.review_id}`}>レビュー詳細</Link>
          </div>
        </article>
      ))}
    </section>
  )
}
