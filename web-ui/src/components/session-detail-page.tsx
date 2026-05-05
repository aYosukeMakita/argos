'use client'

import { fetchReview, fetchSession, fetchSessionMessages } from '@/lib/api'
import { getMessageModelLabel } from '@/lib/model-label'
import type { DiscussionMessageRecord, ReviewRecord } from '@/lib/types'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { MarkdownContent, type FindingOutcome } from '@/components/markdown-content'
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

function extractFindingOutcomes(messages: DiscussionMessageRecord[]): Partial<Record<string, FindingOutcome>> {
  const finalExaminerMessage = [...messages]
    .reverse()
    .find(message => message.agent === 'EXAMINER' && message.judgment !== null)

  if (!finalExaminerMessage) {
    return {}
  }

  const outcomes: Partial<Record<string, FindingOutcome>> = {}
  const sectionPattern = /^###\s+([HML]\d+)\s*$([\s\S]*?)(?=^###\s+[HML]\d+\s*$|^##\s+|\Z)/gm

  for (const match of finalExaminerMessage.content.matchAll(sectionPattern)) {
    const findingId = match[1]
    const sectionBody = match[2] ?? ''
    const verdict = /^-\s*判定:\s*(.+)$/m.exec(sectionBody)?.[1]?.trim()

    if (verdict === '妥当') {
      outcomes[findingId] = 'bug'
      continue
    }

    if (verdict === '要再検討' || verdict === '根拠不足') {
      outcomes[findingId] = 'false-positive'
    }
  }

  return outcomes
}

export function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const sessionState = usePollingResource(() => fetchSession(sessionId), [sessionId])
  const messagesState = usePollingResource(() => fetchSessionMessages(sessionId), [sessionId])
  const reviewState = usePollingResource<ReviewRecord | null>(
    () => (sessionState.data ? fetchReview(sessionState.data.review_id) : Promise.resolve(null)),
    [sessionState.data?.review_id ?? ''],
  )

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
  const findingOutcomes = session.status === 'finished' ? extractFindingOutcomes(messages) : undefined

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
            <strong>{session.review_id}</strong>
          </div>
          <div>
            <span className="meta-label">Examiner</span>
            <strong>{actorLabel(session.examiner)}</strong>
          </div>
          <div>
            <span className="meta-label">Review Model</span>
            <strong>{reviewMessage ? getMessageModelLabel(reviewMessage) : '-'}</strong>
          </div>
          <div>
            <span className="meta-label">Review Created</span>
            <strong>{reviewState.data ? new Date(reviewState.data.created_at).toLocaleString() : '-'}</strong>
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
              <MarkdownContent className="timeline-copy" content={message.content} findingOutcomes={findingOutcomes} />
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
