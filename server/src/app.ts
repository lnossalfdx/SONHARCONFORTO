import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { router } from './routes/index.js'

export const createApp = () => {
  const app = express()
  const allowedOrigins = new Set([
    'https://sonharconforto.com.br',
    'https://www.sonharconforto.com.br',
    'https://resp.sonharconforto.com.br',
    'http://localhost:5173',
    'http://localhost:3000',
  ])
  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (allowedOrigins.has(origin)) return callback(null, true)
      return callback(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }
  app.use(cors(corsOptions))
  app.options('*', cors(corsOptions))
  app.use(express.json({ limit: '50mb', type: ['application/json', 'application/*+json'] }))
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
