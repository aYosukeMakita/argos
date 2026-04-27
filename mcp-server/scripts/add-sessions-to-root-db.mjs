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
  console.error('Usage: node add-sessions-to-root-db.mjs <review_id> [count]')
  process.exit(1)
}

// repo-root ./data
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.join(__dirname, '..', '..', 'data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
const dbPath = path.join(dataDir, 'argos.sqlite')
const db = new Database(dbPath)

const nowIso = () => new Date().toISOString()

// Ensure tables exist (in case DB was empty)
db.exec(`
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL CHECK (agent_name IN ('REVIEWER')),
  model_name TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  reviewer TEXT NOT NULL CHECK (reviewer IN ('REVIEWER')),
  examiner TEXT NOT NULL CHECK (examiner = 'EXAMINER'),
  max_rounds INTEGER NOT NULL CHECK (max_rounds = 3),
  current_round INTEGER NOT NULL CHECK (current_round BETWEEN 1 AND 3),
  next_actor TEXT,
  status TEXT NOT NULL CHECK (status IN ('ongoing', 'finished')),
  final_judgment TEXT CHECK (final_judgment IN ('OK', 'NG')),
  completion_reason TEXT CHECK (completion_reason IN ('approved', 'max_rounds_reached')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (review_id) REFERENCES reviews(id)
);

CREATE TABLE IF NOT EXISTS discussion_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 3),
  agent TEXT NOT NULL CHECK (agent IN ('REVIEWER', 'EXAMINER')),
  model_name TEXT,
  content TEXT NOT NULL,
  judgment TEXT CHECK (judgment IN ('OK', 'NG')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  UNIQUE(session_id, round, agent)
);

CREATE INDEX IF NOT EXISTS idx_sessions_review_id ON sessions(review_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status_created_at ON sessions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_discussion_messages_session_round_created_at
  ON discussion_messages(session_id, round, created_at);
`)

// Ensure review exists; create placeholder if missing
const row = db.prepare(`SELECT id FROM reviews WHERE id = ?`).get(reviewId)
if (!row) {
  console.log('Review not found in repo-root DB, creating placeholder:', reviewId)
  const insertReview = db.prepare(
    `INSERT INTO reviews (id, agent_name, model_name, content, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
  insertReview.run(reviewId, 'REVIEWER', 'auto', 'Auto-created review for session insertion (root DB)', nowIso())
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
  insertSession.run(sid, reviewId, 'REVIEWER', 'EXAMINER', 'EXAMINER', ts, ts)
  const reviewContentRow = db.prepare(`SELECT content, model_name FROM reviews WHERE id = ?`).get(reviewId)
  const msgContent = reviewContentRow ? reviewContentRow.content : 'Auto-created session'
  const modelName = reviewContentRow ? reviewContentRow.model_name : null
  insertMessage.run(sid, 1, 'REVIEWER', modelName, msgContent, ts)
  created.push(sid)
}

console.log('Inserted sessions for', reviewId)
console.log(created.join('\n'))

db.close()
