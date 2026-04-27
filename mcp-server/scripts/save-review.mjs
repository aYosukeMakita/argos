import { createDatabase } from '../dist/db.js'
import { ArgosService } from '../dist/service.js'

const db = createDatabase()
const service = new ArgosService(db)

try {
  const result = service.saveReview('REVIEWER', 'save_review test from script', 'ScriptModel')
  console.log('save_review result:', JSON.stringify(result))
} catch (err) {
  console.error('save_review error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
} finally {
  db.close()
}
