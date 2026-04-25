import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ArgosService } from './service.js'

function toStructuredContent(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

export function createMcpServer(service: ArgosService): McpServer {
  const server = new McpServer({
    name: 'argos-mcp-server',
    version: '0.1.0',
  })

  server.tool(
    'save_review',
    {
      agent_name: z.enum(['REVIEWER']),
      model_name: z.string().trim().min(1).max(120).optional(),
      content: z.string(),
    },
    async ({ agent_name, model_name, content }) => {
      const result = service.saveReview(agent_name, content, model_name)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: toStructuredContent(result),
      }
    },
  )

  server.tool(
    'get_review',
    {
      review_id: z.string(),
    },
    async ({ review_id }) => {
      const result = service.getReview(review_id)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: toStructuredContent(result),
      }
    },
  )

  server.tool(
    'list_reviews',
    {
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async ({ limit, offset }) => {
      const result = service.listReviews({ limit, offset })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: toStructuredContent(result),
      }
    },
  )

  server.tool(
    'start_session',
    {
      review_id: z.string(),
      reviewer: z.enum(['REVIEWER']).optional(),
    },
    async ({ review_id, reviewer }) => {
      const result = service.startSession(review_id, reviewer)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: toStructuredContent(result),
      }
    },
  )

  server.tool(
    'get_session',
    {
      session_id: z.string(),
    },
    async ({ session_id }) => {
      const result = service.getSession(session_id)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: toStructuredContent(result),
      }
    },
  )

  server.tool(
    'list_sessions',
    {
      review_id: z.string().optional(),
      status: z.enum(['ongoing', 'finished']).optional(),
    },
    async ({ review_id, status }) => {
      const result = service.listSessions({ review_id, status })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: toStructuredContent(result),
      }
    },
  )

  server.tool(
    'get_session_messages',
    {
      session_id: z.string(),
    },
    async ({ session_id }) => {
      const result = service.getSessionMessages(session_id)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: toStructuredContent(result),
      }
    },
  )

  server.tool(
    'submit_message',
    {
      session_id: z.string(),
      agent: z.enum(['REVIEWER', 'EXAMINER']),
      model_name: z.string().trim().min(1).max(120).optional(),
      content: z.string(),
      judgment: z.enum(['OK', 'NG']).nullable().optional(),
    },
    async ({ session_id, agent, model_name, content, judgment }) => {
      const result = service.submitMessage(session_id, agent, content, judgment, model_name)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: toStructuredContent(result),
      }
    },
  )

  server.tool(
    'get_next_action',
    {
      session_id: z.string(),
    },
    async ({ session_id }) => {
      const result = service.getNextAction(session_id)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: toStructuredContent(result),
      }
    },
  )

  return server
}
