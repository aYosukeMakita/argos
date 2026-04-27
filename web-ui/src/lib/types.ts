export interface ReviewRecord {
  id: string
  agent_name: 'REVIEWER'
  model_name: string | null
  content: string
  created_at: string
}

export interface SessionRecord {
  id: string
  review_id: string
  reviewer: 'REVIEWER'
  examiner: 'EXAMINER'
  examiner_model_name: string | null
  current_round: number
  max_rounds: number
  next_actor: 'REVIEWER' | 'EXAMINER' | null
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
  agent: 'REVIEWER' | 'EXAMINER'
  model_name: string | null
  content: string
  judgment: 'OK' | 'NG' | null
  created_at: string
}

export interface ListResult<T> {
  items: T[]
  total: number
}
