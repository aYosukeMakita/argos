'use client'

import Link from 'next/link'
import { fetchSession, fetchSessionMessages } from '@/lib/api'
import { getMessageModelLabel } from '@/lib/model-label'
import type { DiscussionMessageRecord } from '@/lib/types'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { MarkdownContent } from '@/components/markdown-content'
import { StatusBadge } from '@/components/status-badge'
import { usePollingResource } from '@/components/use-polling-resource'

function judgmentTone(value: string | null): 'neutral' | 'success' | 'danger' {
  if (value === 'OK') {
    return 'success'
  }
  if (value === 'NG') {
    return 'danger'
  }
  return 'neutral'
}

function actorLabel(actor: 'REVIEWER' | 'EXAMINER' | null): string {
  if (actor === 'EXAMINER') {
    return 'Examiner'
  }

  if (actor === 'REVIEWER') {
    return 'Reviewer'
  }

  return actor ?? '-'
}

export function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const sessionState = usePollingResource(() => fetchSession(sessionId), [sessionId])
  const messagesState = usePollingResource(() => fetchSessionMessages(sessionId), [sessionId])

  if (sessionState.isLoading && !sessionState.data) {
    return <LoadingState label="セッション詳細を読み込み中です。" />
  }

  if (sessionState.error && !sessionState.data) {
    return <ErrorState message={sessionState.error} />
  }

  const session = sessionState.data
  if (!session) {
    return <EmptyState title="セッションが見つかりません" description="指定された session_id は存在しません。" />
  }

  const messages = messagesState.data?.items ?? []
  const reviewMessage = messages.find(message => message.round === 1 && message.agent === 'REVIEWER') ?? null
  const examinerMessage = messages.find(message => message.agent === 'EXAMINER') ?? null

  return (
    <div className="detail-grid">
      <article className="panel-card">
        <div className="card-header">
          <div>
            <p className="card-label">Session Timeline</p>
            <h2>{session.id}</h2>
          </div>
          <div className="badge-stack">
            <StatusBadge tone={session.status === 'finished' ? 'success' : 'warning'}>{session.status}</StatusBadge>
            <StatusBadge tone={judgmentTone(session.final_judgment)}>{session.final_judgment ?? 'pending'}</StatusBadge>
          </div>
        </div>
        <div className="session-meta-grid compact-grid">
          <div>
            <span className="meta-label">Review</span>
            <Link href={`/reviews/${session.review_id}`}>{session.review_id}</Link>
          </div>
          <div>
            <span className="meta-label">Examiner</span>
            <strong>{actorLabel(session.examiner)}</strong>
          </div>
          <div>
            <span className="meta-label">Review Model</span>
            <strong>{reviewMessage?.model_name ?? '-'}</strong>
          </div>
          <div>
            <span className="meta-label">Examiner Model</span>
            <strong>{examinerMessage?.model_name ?? '-'}</strong>
          </div>
          <div>
            <span className="meta-label">Current Round</span>
            <strong>{session.current_round}</strong>
          </div>
          <div>
            <span className="meta-label">Next Actor</span>
            <strong>{actorLabel(session.next_actor)}</strong>
          </div>
          <div>
            <span className="meta-label">Completion</span>
            <strong>{session.completion_reason ?? '-'}</strong>
          </div>
          <div>
            <span className="meta-label">Updated</span>
            <strong>{new Date(session.updated_at).toLocaleString()}</strong>
          </div>
        </div>

        {messagesState.error && !messagesState.data ? <ErrorState message={messagesState.error} /> : null}

        <div className="timeline-grid">
          {messages.map(message => (
            <article
              className={`timeline-card ${message.agent === 'REVIEWER' ? 'align-left' : 'align-right'}`}
              key={message.id}
            >
              <div className="timeline-head">
                <span>Round {message.round}</span>
                <span>{getMessageModelLabel(message)}</span>
              </div>
              <MarkdownContent className="timeline-copy" content={message.content} />
              <div className="timeline-foot">
                <span>{new Date(message.created_at).toLocaleString()}</span>
                {message.judgment ? (
                  <StatusBadge tone={judgmentTone(message.judgment)}>{message.judgment}</StatusBadge>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </article>

      <aside className="panel-card side-panel accent-panel">
        <p className="card-label">Flow Notes</p>
        <h2>運用メモ</h2>
        <ul className="plain-list">
          <li>Round 1 の reviewer 発言は start_session 時に自動生成されます。</li>
          <li>ポーリング間隔は 5 秒です。</li>
          <li>finished のセッションは submit_message を受け付けません。</li>
        </ul>
      </aside>
    </div>
  )
}
