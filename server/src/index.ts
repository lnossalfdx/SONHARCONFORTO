import { createApp } from './app.js'
import { env } from './config/env.js'

const start = async () => {
  const app = createApp()
  app.listen(env.port, () => {
    console.log(`API rodando em http://localhost:${env.port}`)
  })
}

start().catch((error) => {
  console.error('Falha ao iniciar a API:', error)
  process.exit(1)
})
