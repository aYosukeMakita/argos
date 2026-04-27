import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Use repository root ./data so both dev and prod reference the same DB
const defaultDataDir = path.resolve(__dirname, '..', '..', 'data')

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? defaultDataDir,
  databasePath: process.env.DATABASE_PATH ?? path.join(defaultDataDir, 'argos.sqlite'),
}
