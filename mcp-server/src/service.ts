import { AppError, assertNonEmpty } from './errors.js'
import { createReviewId, createSessionId } from './ids.js'
import type {
  AgentName,
  DiscussionMessageRecord,
  FinalJudgment,
  ListResult,
  NextAction,
  ReviewRecord,
  SessionRecord,
  SubmitMessageResult,
} from './types.js'
import type { SqliteDatabase } from './db.js'

function nowIso(): string {
  return new Date().toISOString()
}

function mapSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.id),
    review_id: String(row.review_id),
    reviewer: row.reviewer as 'REVIEWER',
    examiner: row.examiner as 'EXAMINER',
    examiner_model_name: typeof row.examiner_model_name === 'string' ? row.examiner_model_name : null,
    max_rounds: Number(row.max_rounds),
    current_round: Number(row.current_round),
    next_actor: (row.next_actor ?? null) as AgentName | null,
    status: row.status as SessionRecord['status'],
    final_judgment: (row.final_judgment ?? null) as FinalJudgment | null,
    completion_reason: (row.completion_reason ?? null) as SessionRecord['completion_reason'],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

function mapReview(row: Record<string, unknown>): ReviewRecord {
  return {
    id: String(row.id),
    agent_name: row.agent_name as 'REVIEWER',
    model_name: typeof row.model_name === 'string' ? row.model_name : null,
    content: String(row.content),
    created_at: String(row.created_at),
  }
}

function mapMessage(row: Record<string, unknown>): DiscussionMessageRecord {
  return {
    id: Number(row.id),
    session_id: String(row.session_id),
    round: Number(row.round),
    agent: row.agent as AgentName,
    model_name: typeof row.model_name === 'string' ? row.model_name : null,
    content: String(row.content),
    judgment: (row.judgment ?? null) as FinalJudgment | null,
    created_at: String(row.created_at),
  }
}

interface PaginationInput {
  limit?: number
  offset?: number
}

function normalizePagination(input: PaginationInput): Required<PaginationInput> {
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0

  if (limit < 1 || limit > 200) {
    throw new AppError(400, 'limit must be between 1 and 200', 'VALIDATION_ERROR')
  }

  if (offset < 0) {
    throw new AppError(400, 'offset must be 0 or greater', 'VALIDATION_ERROR')
  }

  return { limit, offset }
}

export class ArgosService {
  constructor(private readonly db: SqliteDatabase) {}

  private normalizeAgent(agent: string): AgentName | null {
    if (agent === 'REVIEWER') {
      return 'REVIEWER'
    }

    if (agent === 'EXAMINER') {
      return 'EXAMINER'
    }

    return null
  }

  saveReview(agentName: string, content: string, modelName?: string): { review_id: string; created_at: string } {
    const normalizedAgentName = this.normalizeAgent(agentName)
    if (normalizedAgentName !== 'REVIEWER') {
      throw new AppError(400, 'agent_name must be REVIEWER', 'VALIDATION_ERROR')
    }

    assertNonEmpty(content, 'content')
    const normalizedModelName = modelName?.trim() || null

    const reviewId = createReviewId()
    const createdAt = nowIso()

    this.db
      .prepare(
        `INSERT INTO reviews (id, agent_name, model_name, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(reviewId, normalizedAgentName, normalizedModelName, content.trim(), createdAt)

    return { review_id: reviewId, created_at: createdAt }
  }

  getReview(reviewId: string): ReviewRecord {
    const row = this.db
      .prepare(`SELECT id, agent_name, model_name, content, created_at FROM reviews WHERE id = ?`)
      .get(reviewId) as Record<string, unknown> | undefined

    if (!row) {
      throw new AppError(404, 'review not found', 'NOT_FOUND')
    }

    return mapReview(row)
  }

  listReviews(input: PaginationInput): ListResult<ReviewRecord> {
    const { limit, offset } = normalizePagination(input)
    const items = this.db
      .prepare(
        `SELECT id, agent_name, model_name, content, created_at
         FROM reviews
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Record<string, unknown>[]

    const totalRow = this.db.prepare(`SELECT COUNT(*) AS count FROM reviews`).get() as { count: number }

    return { items: items.map(mapReview), total: totalRow.count }
  }

  deleteReview(reviewId: string): { review_id: string; deleted_sessions: number } {
    this.getReview(reviewId)

    const sessionCountRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM sessions WHERE review_id = ?`)
      .get(reviewId) as { count: number }

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM discussion_messages
           WHERE session_id IN (
             SELECT id
             FROM sessions
             WHERE review_id = ?
           )`,
        )
        .run(reviewId)

      this.db.prepare(`DELETE FROM sessions WHERE review_id = ?`).run(reviewId)
      this.db.prepare(`DELETE FROM reviews WHERE id = ?`).run(reviewId)
    })

    transaction()

    return { review_id: reviewId, deleted_sessions: sessionCountRow.count }
  }

  startSession(
    reviewId: string,
    reviewer = 'REVIEWER',
  ): {
    session_id: string
    review_id: string
    current_round: number
    next_actor: string
    status: string
  } {
    const normalizedReviewer = this.normalizeAgent(reviewer)
    if (normalizedReviewer !== 'REVIEWER') {
      throw new AppError(400, 'reviewer must be REVIEWER', 'VALIDATION_ERROR')
    }

    const review = this.getReview(reviewId)

    const sessionId = createSessionId()
    const createdAt = nowIso()

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sessions (
             id, review_id, reviewer, examiner, max_rounds, current_round, next_actor,
             status, final_judgment, completion_reason, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 3, 1, ?, 'ongoing', NULL, NULL, ?, ?)`,
        )
        .run(sessionId, reviewId, normalizedReviewer, 'EXAMINER', 'EXAMINER', createdAt, createdAt)

      this.db
        .prepare(
          `INSERT INTO discussion_messages (session_id, round, agent, model_name, content, judgment, created_at)
           VALUES (?, 1, 'REVIEWER', ?, ?, NULL, ?)`,
        )
        .run(sessionId, review.model_name, review.content, createdAt)
    })

    transaction()

    return {
      session_id: sessionId,
      review_id: reviewId,
      current_round: 1,
      next_actor: 'EXAMINER',
      status: 'ongoing',
    }
  }

  getSession(sessionId: string): SessionRecord {
    const row = this.db
      .prepare(
        `SELECT sessions.*, (
           SELECT discussion_messages.model_name
           FROM discussion_messages
           WHERE discussion_messages.session_id = sessions.id
             AND discussion_messages.agent = 'EXAMINER'
             AND discussion_messages.model_name IS NOT NULL
           ORDER BY discussion_messages.created_at ASC, discussion_messages.id ASC
           LIMIT 1
         ) AS examiner_model_name
         FROM sessions
         WHERE id = ?`,
      )
      .get(sessionId) as Record<string, unknown> | undefined

    if (!row) {
      throw new AppError(404, 'session not found', 'NOT_FOUND')
    }

    return mapSession(row)
  }

  listSessions(filters: { review_id?: string; status?: string }): ListResult<SessionRecord> {
    const clauses: string[] = []
    const params: unknown[] = []

    if (filters.review_id) {
      clauses.push('review_id = ?')
      params.push(filters.review_id)
    }

    if (filters.status) {
      if (filters.status !== 'ongoing' && filters.status !== 'finished') {
        throw new AppError(400, 'status must be ongoing or finished', 'VALIDATION_ERROR')
      }
      clauses.push('status = ?')
      params.push(filters.status)
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

    const items = this.db
      .prepare(
        `SELECT sessions.*, (
           SELECT discussion_messages.model_name
           FROM discussion_messages
           WHERE discussion_messages.session_id = sessions.id
             AND discussion_messages.agent = 'EXAMINER'
             AND discussion_messages.model_name IS NOT NULL
           ORDER BY discussion_messages.created_at ASC, discussion_messages.id ASC
           LIMIT 1
         ) AS examiner_model_name
         FROM sessions
         ${whereClause}
         ORDER BY sessions.created_at DESC`,
      )
      .all(...params) as Record<string, unknown>[]

    return { items: items.map(mapSession), total: items.length }
  }

  getSessionMessages(sessionId: string): { items: DiscussionMessageRecord[] } {
    this.getSession(sessionId)

    const items = this.db
      .prepare(
        `SELECT id, session_id, round, agent, model_name, content, judgment, created_at
         FROM discussion_messages
         WHERE session_id = ?
         ORDER BY round ASC, created_at ASC`,
      )
      .all(sessionId) as Record<string, unknown>[]

    return { items: items.map(mapMessage) }
  }

  submitMessage(
    sessionId: string,
    agent: string,
    content: string,
    judgment?: string | null,
    modelName?: string,
  ): SubmitMessageResult {
    assertNonEmpty(content, 'content')
    const normalizedModelName = modelName?.trim() || null
    const normalizedAgent = this.normalizeAgent(agent)

    if (!normalizedAgent) {
      throw new AppError(400, 'agent must be REVIEWER or EXAMINER', 'VALIDATION_ERROR')
    }

    const session = this.getSession(sessionId)
    if (session.status === 'finished') {
      throw new AppError(409, 'session is already finished', 'STATE_CONFLICT')
    }

    if (session.next_actor !== normalizedAgent) {
      throw new AppError(409, 'agent is not allowed to post now', 'STATE_CONFLICT')
    }

    const createdAt = nowIso()

    if (normalizedAgent === 'REVIEWER') {
      if (judgment !== undefined && judgment !== null) {
        throw new AppError(400, 'reviewer judgment must be null', 'VALIDATION_ERROR')
      }

      if (session.current_round < 2 || session.current_round > 3) {
        throw new AppError(409, 'reviewer can only post in round 2 or 3', 'STATE_CONFLICT')
      }

      try {
        const transaction = this.db.transaction(() => {
          this.db
            .prepare(
              `INSERT INTO discussion_messages (session_id, round, agent, model_name, content, judgment, created_at)
               VALUES (?, ?, 'REVIEWER', ?, ?, NULL, ?)`,
            )
            .run(sessionId, session.current_round, normalizedModelName, content.trim(), createdAt)

          this.db
            .prepare(
              `UPDATE sessions
               SET next_actor = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(session.examiner, createdAt, sessionId)
        })

        transaction()
      } catch (error) {
        this.rethrowSqliteConflict(error, 'reviewer has already posted in this round')
      }

      return this.toSubmitMessageResult(this.getSession(sessionId))
    }

    if (normalizedAgent !== session.examiner) {
      throw new AppError(400, 'examiner must match the session examiner', 'VALIDATION_ERROR')
    }

    if (judgment !== 'OK' && judgment !== 'NG') {
      throw new AppError(400, 'judgment must be OK or NG', 'VALIDATION_ERROR')
    }

    try {
      const transaction = this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO discussion_messages (session_id, round, agent, model_name, content, judgment, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            sessionId,
            session.current_round,
            normalizedAgent,
            normalizedModelName,
            content.trim(),
            judgment,
            createdAt,
          )

        if (judgment === 'OK') {
          this.db
            .prepare(
              `UPDATE sessions
               SET next_actor = NULL,
                   status = 'finished',
                   final_judgment = 'OK',
                   completion_reason = 'approved',
                   updated_at = ?
               WHERE id = ?`,
            )
            .run(createdAt, sessionId)
          return
        }

        if (session.current_round === 3) {
          this.db
            .prepare(
              `UPDATE sessions
               SET next_actor = NULL,
                   status = 'finished',
                   final_judgment = 'NG',
                   completion_reason = 'max_rounds_reached',
                   updated_at = ?
               WHERE id = ?`,
            )
            .run(createdAt, sessionId)
          return
        }

        this.db
          .prepare(
            `UPDATE sessions
             SET current_round = current_round + 1,
                 next_actor = 'REVIEWER',
                 updated_at = ?
             WHERE id = ?`,
          )
          .run(createdAt, sessionId)
      })

      transaction()
    } catch (error) {
      this.rethrowSqliteConflict(error, 'examiner has already posted in this round')
    }

    return this.toSubmitMessageResult(this.getSession(sessionId))
  }

  getNextAction(sessionId: string): NextAction {
    const session = this.getSession(sessionId)
    return {
      agent: session.status === 'ongoing' ? session.next_actor : null,
      round: session.current_round,
      status: session.status,
      final_judgment: session.final_judgment,
      completion_reason: session.completion_reason,
    }
  }

  private toSubmitMessageResult(session: SessionRecord): SubmitMessageResult {
    return {
      session_id: session.id,
      current_round: session.current_round,
      next_actor: session.status === 'ongoing' ? session.next_actor : null,
      status: session.status,
      final_judgment: session.final_judgment,
      completion_reason: session.completion_reason,
    }
  }

  private rethrowSqliteConflict(error: unknown, fallbackMessage: string): never {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      throw new AppError(409, fallbackMessage, 'STATE_CONFLICT')
    }
    throw error
  }
}
