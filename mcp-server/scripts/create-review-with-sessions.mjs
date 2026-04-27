import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

function timestampPart(now = new Date()) {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const hours = String(now.getUTCHours()).padStart(2, '0')
  const minutes = String(now.getUTCMinutes()).padStart(2, '0')
  const seconds = String(now.getUTCSeconds()).padStart(2, '0')
  return `${year}${month}${day}${hours}${minutes}${seconds}`
}

function createReviewId(now = new Date()) {
  return `review_${timestampPart(now)}_${Math.random().toString(16).slice(2, 8)}`
}

function createSessionId(now = new Date()) {
  return `session_REX_${timestampPart(now)}_${Math.random().toString(16).slice(2, 8)}`
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
const dbPath = path.join(dataDir, 'argos.sqlite')
const db = new Database(dbPath)

const nowIso = () => new Date().toISOString()

// Create review
const reviewId = createReviewId()
const createdAt = nowIso()
const insertReview = db.prepare(
  `INSERT INTO reviews (id, agent_name, model_name, content, created_at) VALUES (?, ?, ?, ?, ?)`,
)
insertReview.run(reviewId, 'REVIEWER', 'ScriptModel', 'Auto-created review via script', createdAt)

// Insert two sessions
const insertSession = db.prepare(
  `INSERT INTO sessions (id, review_id, reviewer, examiner, max_rounds, current_round, next_actor, status, final_judgment, completion_reason, created_at, updated_at)
   VALUES (?, ?, ?, ?, 3, 1, ?, 'ongoing', NULL, NULL, ?, ?)`,
)

const insertMessage = db.prepare(
  `INSERT INTO discussion_messages (session_id, round, agent, model_name, content, judgment, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
)

const createdSessions = []
for (let i = 0; i < 2; i++) {
  const sid = createSessionId(new Date(Date.now() + i))
  const ts = nowIso()
  insertSession.run(sid, reviewId, 'REVIEWER', 'EXAMINER', 'EXAMINER', ts, ts)
  insertMessage.run(sid, 1, 'REVIEWER', 'ScriptModel', 'Initial reviewer message', ts)
  createdSessions.push(sid)
}

console.log('Created review:', reviewId)
console.log('Created sessions:')
console.log(createdSessions.join('\n'))

db.close()
