'use client'

import Link from 'next/link'
import { fetchReview, fetchSessions } from '@/lib/api'
import { getReviewModelLabel } from '@/lib/model-label'
import type { ReviewRecord } from '@/lib/types'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { usePollingResource } from '@/components/use-polling-resource'

function examinerLabel(modelName: string | null): string {
  return modelName ?? 'Examiner'
}

export function ReviewDetailPage({ reviewId }: { reviewId: string }) {
  const reviewState = usePollingResource(() => fetchReview(reviewId), [reviewId])
  const sessionsState = usePollingResource(() => fetchSessions(reviewId), [reviewId])

  if (reviewState.isLoading && !reviewState.data) {
    return <LoadingState label="レビュー詳細を読み込み中です。" />
  }

  if (reviewState.error && !reviewState.data) {
    return <ErrorState message={reviewState.error} />
  }

  const review = reviewState.data
  if (!review) {
    return <EmptyState title="レビューが見つかりません" description="指定された review_id は存在しません。" />
  }

  return (
    <div className="detail-grid">
      <article className="panel-card prose-card">
        <div className="card-header">
          <div>
            <p className="card-label">Primary Review</p>
            <h2>{review.id}</h2>
          </div>
          <StatusBadge tone="neutral">{getReviewModelLabel(review)}</StatusBadge>
        </div>
        <p className="meta-text">作成日時: {new Date(review.created_at).toLocaleString()}</p>
        <div className="review-body">{review.content}</div>
      </article>

      <aside className="panel-card side-panel">
        <div className="card-header">
          <div>
            <p className="card-label">Sessions</p>
            <h2>関連セッション</h2>
          </div>
        </div>
        {sessionsState.error && !sessionsState.data ? <ErrorState message={sessionsState.error} /> : null}
        {sessionsState.data && sessionsState.data.items.length === 0 ? (
          <EmptyState title="セッションはまだありません" description="start_session 後にここへ表示されます。" />
        ) : null}
        <div className="side-list">
          {sessionsState.data?.items.map(session => (
            <Link className="side-link" href={`/sessions/${session.id}`} key={session.id}>
              <span>{session.id}</span>
              <span>{examinerLabel(session.examiner_model_name)}</span>
              <StatusBadge tone={session.status === 'finished' ? 'success' : 'warning'}>{session.status}</StatusBadge>
            </Link>
          ))}
        </div>
      </aside>
    </div>
  )
}
