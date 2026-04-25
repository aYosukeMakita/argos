export interface ReviewRecord {
  id: string
  agent_name: 'A'
  model_name: string | null
  content: string
  created_at: string
}

export interface SessionRecord {
  id: string
  review_id: string
  reviewer: 'A'
  examiner: 'EXAMINER'
  current_round: number
  max_rounds: number
  next_actor: 'A' | 'EXAMINER' | null
  status: 'ongoing' | 'finished'
  final_judgment: 'OK' | 'NG' | null
  completion_reason: 'approved' | 'max_rounds_reached' | null
  created_at: string
  updated_at: string
}

export interface DiscussionMessageRecord {
  id: number
  session_id: string
  round: number
  agent: 'A' | 'EXAMINER'
  model_name: string | null
  content: string
  judgment: 'OK' | 'NG' | null
  created_at: string
}

export interface ListResult<T> {
  items: T[]
  total: number
}
