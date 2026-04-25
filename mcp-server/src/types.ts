export type AgentName = 'REVIEWER' | 'EXAMINER'
export type ReviewerName = 'REVIEWER'
export type ExaminerName = 'EXAMINER'
export type SessionStatus = 'ongoing' | 'finished'
export type FinalJudgment = 'OK' | 'NG'
export type CompletionReason = 'approved' | 'max_rounds_reached'

export interface ReviewRecord {
  id: string
  agent_name: ReviewerName
  model_name: string | null
  content: string
  created_at: string
}

export interface SessionRecord {
  id: string
  review_id: string
  reviewer: ReviewerName
  examiner: ExaminerName
  max_rounds: number
  current_round: number
  next_actor: AgentName | null
  status: SessionStatus
  final_judgment: FinalJudgment | null
  completion_reason: CompletionReason | null
  created_at: string
  updated_at: string
}

export interface DiscussionMessageRecord {
  id: number
  session_id: string
  round: number
  agent: AgentName
  model_name: string | null
  content: string
  judgment: FinalJudgment | null
  created_at: string
}

export interface ListResult<T> {
  items: T[]
  total: number
}

export interface NextAction {
  agent: AgentName | null
  round: number
  status: SessionStatus
  final_judgment: FinalJudgment | null
  completion_reason: CompletionReason | null
}

export interface SubmitMessageResult {
  session_id: string
  current_round: number
  next_actor: AgentName | null
  status: SessionStatus
  final_judgment: FinalJudgment | null
  completion_reason: CompletionReason | null
}
