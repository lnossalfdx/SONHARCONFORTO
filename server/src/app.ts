import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { router } from './routes/index.js'

export const createApp = () => {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '50mb' }))
  app.use(
    express.urlencoded({
      extended: true,
      limit: '100mb',
    }),
  )
  app.use(helmet())
  app.use(morgan('tiny'))

  app.get('/health', (_, response) => response.json({ status: 'ok' }))
  app.use('/api', router)

  app.use((error: any, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error)
    if (response.headersSent) {
      return response.end()
    }
    return response.status(error?.status ?? 500).json({ message: error?.message ?? 'Erro interno do servidor.' })
  })

  return app
}
