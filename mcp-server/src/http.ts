import cors from 'cors'
import express from 'express'
import { z } from 'zod'
import { AppError } from './errors.js'
import type { ArgosService } from './service.js'

export function createRestApp(service: ArgosService): express.Express {
  const app = express()

  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.get('/api/reviews', (req, res, next) => {
    try {
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      const parsed = query.parse(req.query)
      res.json(service.listReviews(parsed))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/reviews/:reviewId', (req, res, next) => {
    try {
      res.json(service.getReview(req.params.reviewId))
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/reviews/:reviewId', (req, res, next) => {
    try {
      res.json(service.deleteReview(req.params.reviewId))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/sessions', (req, res, next) => {
    try {
      const query = z.object({
        review_id: z.string().optional(),
        status: z.enum(['ongoing', 'finished']).optional(),
      })
      const parsed = query.parse(req.query)
      res.json(service.listSessions(parsed))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/sessions/:sessionId', (req, res, next) => {
    try {
      res.json(service.getSession(req.params.sessionId))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/sessions/:sessionId/messages', (req, res, next) => {
    try {
      res.json(service.getSessionMessages(req.params.sessionId))
    } catch (error) {
      next(error)
    }
  })

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: error.flatten() })
      return
    }

    if (error instanceof AppError) {
      res.status(error.statusCode).json({ code: error.code, message: error.message })
      return
    }

    console.error(error)
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'internal server error' })
  })

  return app
}
