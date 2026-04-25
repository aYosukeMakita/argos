import crypto from 'node:crypto'

function timestampPart(now: Date): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const hours = String(now.getUTCHours()).padStart(2, '0')
  const minutes = String(now.getUTCMinutes()).padStart(2, '0')
  const seconds = String(now.getUTCSeconds()).padStart(2, '0')
  return `${year}${month}${day}${hours}${minutes}${seconds}`
}

export function createReviewId(now = new Date()): string {
  return `review_${timestampPart(now)}_${crypto.randomBytes(3).toString('hex')}`
}

export function createSessionId(now = new Date()): string {
  return `session_REX_${timestampPart(now)}_${crypto.randomBytes(3).toString('hex')}`
}
