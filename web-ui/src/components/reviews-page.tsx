'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { deleteReview, fetchReviews, fetchSessions } from '@/lib/api'
import { getReviewModelLabel } from '@/lib/model-label'
import type { ReviewRecord, SessionRecord } from '@/lib/types'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { usePollingResource } from '@/components/use-polling-resource'

function countSessionsByReview(items: SessionRecord[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const session of items) {
    counts.set(session.review_id, (counts.get(session.review_id) ?? 0) + 1)
  }
  return counts
}

function summarizeReviewStatus(items: SessionRecord[]): Map<string, 'Not Started' | 'Ongoing' | 'Finished'> {
  const statuses = new Map<string, 'Not Started' | 'Ongoing' | 'Finished'>()

  for (const session of items) {
    if (session.status !== 'finished') {
      statuses.set(session.review_id, 'Ongoing')
      continue
    }

    if (!statuses.has(session.review_id)) {
      statuses.set(session.review_id, 'Finished')
    }
  }

  return statuses
}

function preview(content: string): string {
  return content.length > 180 ? `${content.slice(0, 180)}...` : content
}

const REVIEWS_PER_PAGE = 10

function createPageHref(page: number): string {
  if (page <= 1) {
    return '/reviews'
  }

  return `/reviews?page=${page}`
}

export function ReviewsPage({ page }: { page: number }) {
  const router = useRouter()
  const currentPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  const offset = (currentPage - 1) * REVIEWS_PER_PAGE
  const [refreshKey, setRefreshKey] = useState(0)
  const [confirmingReviewId, setConfirmingReviewId] = useState<string | null>(null)
  const [deletingReviewId, setDeletingReviewId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const reviewsState = usePollingResource(
    () => fetchReviews({ limit: REVIEWS_PER_PAGE, offset }),
    [currentPage, refreshKey],
  )
  const sessionsState = usePollingResource(() => fetchSessions(), [refreshKey])

  const sessionCounts = useMemo(() => {
    const items = sessionsState.data?.items ?? []
    return countSessionsByReview(items)
  }, [sessionsState.data])

  const reviewStatuses = useMemo(() => {
    const items = sessionsState.data?.items ?? []
    return summarizeReviewStatus(items)
  }, [sessionsState.data])

  if (reviewsState.isLoading && !reviewsState.data) {
    return <LoadingState label="レビュー一覧を読み込み中です。" />
  }

  if (reviewsState.error && !reviewsState.data) {
    return <ErrorState message={reviewsState.error} />
  }

  const reviews = reviewsState.data?.items ?? []
  const totalReviews = reviewsState.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalReviews / REVIEWS_PER_PAGE))

  if (reviews.length === 0 && totalReviews === 0) {
    return <EmptyState title="レビューはまだありません" description="save_review が呼ばれるとここに表示されます。" />
  }

  if (reviews.length === 0) {
    return <ErrorState message={`ページ ${currentPage} に表示できるレビューはありません。`} />
  }

  const firstItem = offset + 1
  const lastItem = offset + reviews.length
  const hasPreviousPage = currentPage > 1
  const hasNextPage = currentPage < totalPages

  const handleDelete = async (reviewId: string) => {
    setDeletingReviewId(reviewId)
    setActionError(null)

    try {
      await deleteReview(reviewId)
      setConfirmingReviewId(null)

      if (reviews.length === 1 && currentPage > 1) {
        router.push(createPageHref(currentPage - 1))
        return
      }

      setRefreshKey(current => current + 1)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'レビューの削除に失敗しました。')
    } finally {
      setDeletingReviewId(current => (current === reviewId ? null : current))
    }
  }

  return (
    <>
      {actionError ? <ErrorState message={actionError} /> : null}

      <section className="stack-grid review-list">
        {reviews.map((review: ReviewRecord) => (
          <article className="panel-card review-card" key={review.id}>
            <div className="card-header">
              <div>
                <p className="card-label">Review</p>
                <h2>{review.id}</h2>
              </div>
              <div className="badge-stack">
                <StatusBadge
                  tone={
                    reviewStatuses.get(review.id) === 'Finished'
                      ? 'success'
                      : reviewStatuses.get(review.id) === 'Ongoing'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {reviewStatuses.get(review.id) ?? 'Not Started'}
                </StatusBadge>
                <StatusBadge tone="neutral">{getReviewModelLabel(review)}</StatusBadge>
              </div>
            </div>
            <p className="card-copy">{preview(review.content)}</p>
            <div className="meta-row">
              <span>{new Date(review.created_at).toLocaleString()}</span>
              <span>{sessionCounts.get(review.id) ?? 0} sessions</span>
            </div>
            <div className="action-row">
              <Link href={`/reviews/${review.id}`}>レビュー詳細</Link>
              <Link href={`/sessions?review_id=${encodeURIComponent(review.id)}`}>関連セッション</Link>
              <button
                className="danger-action"
                disabled={deletingReviewId === review.id}
                onClick={() => {
                  setActionError(null)
                  setConfirmingReviewId(review.id)
                }}
                type="button"
              >
                {deletingReviewId === review.id ? '削除中...' : '削除'}
              </button>
            </div>
            {confirmingReviewId === review.id ? (
              <div className="confirm-strip" role="alert">
                <p className="confirm-copy">このレビューと関連セッションを削除します。よろしいですか？</p>
                <div className="confirm-actions">
                  <button
                    className="danger-action"
                    disabled={deletingReviewId === review.id}
                    onClick={() => void handleDelete(review.id)}
                    type="button"
                  >
                    削除する
                  </button>
                  <button
                    className="secondary-action"
                    disabled={deletingReviewId === review.id}
                    onClick={() => setConfirmingReviewId(current => (current === review.id ? null : current))}
                    type="button"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <nav aria-label="レビュー一覧のページング" className="pagination-row">
        <p className="pagination-summary">
          {totalReviews} 件中 {firstItem}-{lastItem} 件を表示
        </p>
        <div className="pagination-controls">
          {hasPreviousPage ? (
            <Link className="pagination-link" href={createPageHref(currentPage - 1)}>
              前へ
            </Link>
          ) : (
            <span aria-disabled="true" className="pagination-link is-disabled">
              前へ
            </span>
          )}
          <span className="pagination-page">
            {currentPage} / {totalPages}
          </span>
          {hasNextPage ? (
            <Link className="pagination-link" href={createPageHref(currentPage + 1)}>
              次へ
            </Link>
          ) : (
            <span aria-disabled="true" className="pagination-link is-disabled">
              次へ
            </span>
          )}
        </div>
      </nav>
    </>
  )
}
