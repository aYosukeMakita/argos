import type { DiscussionMessageRecord, ReviewRecord } from '@/lib/types'

const REVIEW_MODEL_PATTERN = /^-\s*レビュー実施モデル:\s*(.+)$/m

function extractModelNameFromText(content: string): string | null {
  const match = content.match(REVIEW_MODEL_PATTERN)
  if (!match) {
    return null
  }

  const modelName = match[1]?.trim()
  return modelName ? modelName : null
}

export function getReviewModelLabel(review: ReviewRecord): string {
  return review.model_name ?? extractModelNameFromText(review.content) ?? review.agent_name
}

export function getMessageModelLabel(message: DiscussionMessageRecord): string {
  return message.model_name ?? extractModelNameFromText(message.content) ?? message.agent
}
