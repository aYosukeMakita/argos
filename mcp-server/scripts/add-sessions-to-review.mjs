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

function createSessionId(now = new Date()) {
  return `session_REX_${timestampPart(now)}_${Math.random().toString(16).slice(2, 8)}`
}

const reviewId = process.argv[2]
const count = parseInt(process.argv[3] || '2', 10)
if (!reviewId) {
  console.error('Usage: node add-sessions-to-review.mjs <review_id> [count]')
  process.exit(1)
}

// Resolve data dir relative to this script file to avoid cwd issues
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
const dbPath = path.join(dataDir, 'argos.sqlite')
const db = new Database(dbPath)

const nowIso = () => new Date().toISOString()

// Ensure review exists; if missing, create a placeholder review
const row = db.prepare(`SELECT id FROM reviews WHERE id = ?`).get(reviewId)
if (!row) {
  console.log('Review not found, creating placeholder:', reviewId)
  const insertReview = db.prepare(
    `INSERT INTO reviews (id, agent_name, model_name, content, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
  insertReview.run(reviewId, 'REVIEWER', 'auto', 'Auto-created review for session insertion', nowIso())
}

const insertSession = db.prepare(
  `INSERT INTO sessions (id, review_id, reviewer, examiner, max_rounds, current_round, next_actor, status, final_judgment, completion_reason, created_at, updated_at)
   VALUES (?, ?, ?, ?, 3, 1, ?, 'ongoing', NULL, NULL, ?, ?)`,
)

const insertMessage = db.prepare(
  `INSERT INTO discussion_messages (session_id, round, agent, model_name, content, judgment, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
)

const created = []
for (let i = 0; i < count; i++) {
  const sid = createSessionId(new Date(Date.now() + i))
  const ts = nowIso()
  // next_actor: set to 'EXAMINER' so examiner starts, mimic seed behavior
  insertSession.run(sid, reviewId, 'REVIEWER', 'EXAMINER', 'EXAMINER', ts, ts)
  // initial reviewer message placeholder
  const reviewContentRow = db.prepare(`SELECT content, model_name FROM reviews WHERE id = ?`).get(reviewId)
  const msgContent = reviewContentRow ? reviewContentRow.content : 'Auto-created session'
  const modelName = reviewContentRow ? reviewContentRow.model_name : null
  insertMessage.run(sid, 1, 'REVIEWER', modelName, msgContent, ts)
  created.push(sid)
}

console.log('Inserted sessions for', reviewId)
console.log(created.join('\n'))

db.close()
