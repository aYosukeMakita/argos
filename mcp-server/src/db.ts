import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from './config.js'

export type SqliteDatabase = Database.Database

const LEGACY_DATABASE_BASENAME = 'macras.sqlite'

function getSidecarPaths(databasePath: string): string[] {
  return [`${databasePath}-shm`, `${databasePath}-wal`]
}

function getRecordCount(databasePath: string): number {
  if (!fs.existsSync(databasePath)) {
    return 0
  }

  const db = new Database(databasePath, { readonly: true })

  try {
    return ['reviews', 'sessions', 'discussion_messages'].reduce((count, tableName) => {
      const tableExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName)

      if (!tableExists) {
        return count
      }

      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }
      return count + row.count
    }, 0)
  } finally {
    db.close()
  }
}

function moveDatabaseFiles(sourcePath: string, targetPath: string): void {
  fs.renameSync(sourcePath, targetPath)

  for (const [sourceSidecarPath, targetSidecarPath] of getSidecarPaths(sourcePath).map((sidecarPath, index) => [
    sidecarPath,
    getSidecarPaths(targetPath)[index],
  ])) {
    if (fs.existsSync(sourceSidecarPath) && !fs.existsSync(targetSidecarPath)) {
      fs.renameSync(sourceSidecarPath, targetSidecarPath)
    }
  }
}

function removeDatabaseFiles(databasePath: string): void {
  if (fs.existsSync(databasePath)) {
    fs.rmSync(databasePath)
  }

  for (const sidecarPath of getSidecarPaths(databasePath)) {
    if (fs.existsSync(sidecarPath)) {
      fs.rmSync(sidecarPath)
    }
  }
}

function migrateLegacyDatabase(targetPath: string): void {
  const legacyPath = path.join(path.dirname(targetPath), LEGACY_DATABASE_BASENAME)

  if (legacyPath === targetPath || !fs.existsSync(legacyPath)) {
    return
  }

  if (!fs.existsSync(targetPath)) {
    moveDatabaseFiles(legacyPath, targetPath)
    return
  }

  const targetRecordCount = getRecordCount(targetPath)
  const legacyRecordCount = getRecordCount(legacyPath)

  if (legacyRecordCount === 0) {
    removeDatabaseFiles(legacyPath)
    return
  }

  if (targetRecordCount === 0 && legacyRecordCount > 0) {
    removeDatabaseFiles(targetPath)
    moveDatabaseFiles(legacyPath, targetPath)
    return
  }

  if (targetRecordCount > 0 && legacyRecordCount > 0) {
    console.warn('Legacy macras.sqlite still exists because both argos.sqlite and macras.sqlite contain data.')
  }
}

function hasColumn(db: SqliteDatabase, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return rows.some(row => row.name === columnName)
}

function ensureNullableTextColumn(db: SqliteDatabase, tableName: string, columnName: string): void {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} TEXT`)
  }
}

function getCreateTableSql(db: SqliteDatabase, tableName: string): string {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName) as
    | { sql?: string }
    | undefined

  return row?.sql ?? ''
}

function needsExaminerSchemaMigration(db: SqliteDatabase): boolean {
  const sessionsSql = getCreateTableSql(db, 'sessions')
  const messagesSql = getCreateTableSql(db, 'discussion_messages')

  if (!sessionsSql || !messagesSql) {
    return false
  }

  return (
    sessionsSql.includes("CHECK (examiner IN ('B', 'C'))") ||
    sessionsSql.includes('UNIQUE(review_id, reviewer, examiner)') ||
    messagesSql.includes("CHECK (agent IN ('A', 'B', 'C'))")
  )
}

function migrateExaminerSchema(db: SqliteDatabase): void {
  if (!needsExaminerSchemaMigration(db)) {
    return
  }

  const migrate = db.transaction(() => {
    db.pragma('foreign_keys = OFF')

    db.exec(`
      CREATE TABLE sessions_new (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL,
        reviewer TEXT NOT NULL CHECK (reviewer IN ('A')),
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

      INSERT INTO sessions_new (
        id, review_id, reviewer, examiner, max_rounds, current_round, next_actor,
        status, final_judgment, completion_reason, created_at, updated_at
      )
      SELECT
        id,
        review_id,
        reviewer,
        'EXAMINER',
        max_rounds,
        current_round,
        CASE
          WHEN next_actor = 'A' THEN 'A'
          WHEN next_actor IS NULL THEN NULL
          ELSE 'EXAMINER'
        END,
        status,
        final_judgment,
        completion_reason,
        created_at,
        updated_at
      FROM sessions;

      CREATE TABLE discussion_messages_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 3),
        agent TEXT NOT NULL CHECK (agent IN ('A', 'EXAMINER')),
        model_name TEXT,
        content TEXT NOT NULL,
        judgment TEXT CHECK (judgment IN ('OK', 'NG')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions_new(id),
        UNIQUE(session_id, round, agent)
      );

      INSERT INTO discussion_messages_new (id, session_id, round, agent, model_name, content, judgment, created_at)
      SELECT
        id,
        session_id,
        round,
        CASE
          WHEN agent = 'A' THEN 'A'
          ELSE 'EXAMINER'
        END,
        model_name,
        content,
        judgment,
        created_at
      FROM discussion_messages;

      DROP TABLE discussion_messages;
      DROP TABLE sessions;
      ALTER TABLE sessions_new RENAME TO sessions;
      ALTER TABLE discussion_messages_new RENAME TO discussion_messages;

      CREATE INDEX IF NOT EXISTS idx_sessions_review_id ON sessions(review_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status_created_at ON sessions(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_discussion_messages_session_round_created_at
        ON discussion_messages(session_id, round, created_at);
    `)

    db.pragma('foreign_keys = ON')
  })

  migrate()
}

export function createDatabase(): SqliteDatabase {
  fs.mkdirSync(config.dataDir, { recursive: true })
  migrateLegacyDatabase(config.databasePath)

  const db = new Database(config.databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

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

  ensureNullableTextColumn(db, 'reviews', 'model_name')
  ensureNullableTextColumn(db, 'discussion_messages', 'model_name')
  migrateExaminerSchema(db)

  return db
}
