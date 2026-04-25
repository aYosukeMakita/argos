import path from 'node:path'

const defaultDataDir = path.resolve(process.cwd(), 'data')

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? defaultDataDir,
  databasePath: process.env.DATABASE_PATH ?? path.join(defaultDataDir, 'argos.sqlite'),
}
