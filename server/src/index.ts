import { createApp } from './app.js'
import { env } from './config/env.js'
import { ensureSchemaCompatibility } from './utils/schemaGuard.js'

const start = async () => {
  await ensureSchemaCompatibility()

  const app = createApp()
  app.listen(env.port, () => {
    console.log(`API rodando em http://localhost:${env.port}`)
  })
}

start().catch((error) => {
  console.error('Falha ao iniciar a API:', error)
  process.exit(1)
})
