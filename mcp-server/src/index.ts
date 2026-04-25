import express from 'express'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { config } from './config.js'
import { createDatabase } from './db.js'
import { AppError } from './errors.js'
import { createRestApp } from './http.js'
import { createMcpServer } from './mcp.js'
import { ArgosService } from './service.js'

const db = createDatabase()
const service = new ArgosService(db)
const restApp = createRestApp(service)
const app = express()

interface McpSessionContext {
  server: ReturnType<typeof createMcpServer>
  transport: StreamableHTTPServerTransport
}

const mcpSessions = new Map<string, McpSessionContext>()

async function createMcpSession(): Promise<McpSessionContext> {
  const server = createMcpServer(service)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })

  transport.onclose = () => {
    const sessionId = transport.sessionId
    if (sessionId) {
      mcpSessions.delete(sessionId)
    }
    void server.close()
  }

  await server.connect(transport)

  return { server, transport }
}

app.use(restApp)

app.all('/mcp', express.json({ limit: '1mb' }), async (req, res) => {
  const sessionId = req.header('mcp-session-id')
  try {
    let context = sessionId ? mcpSessions.get(sessionId) : undefined

    if (!context) {
      if (sessionId) {
        res.status(404).json({
          code: 'SESSION_NOT_FOUND',
          message: 'MCP session not found',
        })
        return
      }

      context = await createMcpSession()
    }

    await context.transport.handleRequest(req, res, req.body)

    const currentSessionId = context.transport.sessionId
    if (currentSessionId && !mcpSessions.has(currentSessionId)) {
      mcpSessions.set(currentSessionId, context)
    }

    if (req.method === 'DELETE' && currentSessionId) {
      mcpSessions.delete(currentSessionId)
      await context.transport.close()
      await context.server.close()
    }
  } catch (error) {
    console.error(error)
    if (!res.headersSent) {
      const statusCode = error instanceof AppError ? error.statusCode : 500
      res.status(statusCode).json({
        code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'internal server error',
      })
    }
  }
})

app.listen(config.port, config.host, () => {
  console.log(`ARGOS MCP server listening on http://${config.host}:${config.port}`)
  console.log(`SQLite database: ${config.databasePath}`)
})
