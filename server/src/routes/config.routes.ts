import { Router } from 'express'
import { env } from '../config/env.js'

const router = Router()

router.get('/supabase', (_request, response) => {
  return response.json({
    url: env.supabaseUrl,
    anonKey: env.supabaseAnonKey,
  })
})

export const configRoutes = router
