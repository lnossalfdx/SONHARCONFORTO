import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { comparePassword, hashPassword } from '../utils/password.js'
import { env } from '../config/env.js'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

router.post('/login', async (request, response) => {
  const credentials = loginSchema.parse(request.body)
  const user = await prisma.user.findUnique({ where: { email: credentials.email } })
  if (!user || !user.active) {
    return response.status(401).json({ message: 'Credenciais inválidas.' })
  }
  const validPassword = await comparePassword(credentials.password, user.passwordHash)
  if (!validPassword) {
    return response.status(401).json({ message: 'Credenciais inválidas.' })
  }

  const token = jwt.sign({ role: user.role }, env.jwtSecret, {
    subject: user.id,
    expiresIn: '12h',
  })

  return response.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      active: user.active,
    },
  })
})

router.get('/me', authMiddleware, async (request, response) => {
  const me = await prisma.user.findUnique({ where: { id: request.user!.id } })
  if (!me) {
    return response.status(404).json({ message: 'Usuário não encontrado.' })
  }
  return response.json({
    id: me.id,
    name: me.name,
    email: me.email,
    phone: me.phone,
    role: me.role,
    active: me.active,
  })
})

const createUserSchema = z.object({
  name: z.string().min(3),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.enum(['admin', 'seller']).default('seller'),
})

router.post('/invite', authMiddleware, roleGuard('admin'), async (request, response) => {
  const payload = createUserSchema.parse(request.body)
  const exists = await prisma.user.findUnique({ where: { email: payload.email } })
  if (exists) {
    return response.status(400).json({ message: 'E-mail já está em uso.' })
  }
  const tempPassword = `crm-${Math.random().toString(36).slice(2, 8)}`
  const passwordHash = await hashPassword(tempPassword)
  const user = await prisma.user.create({
    data: { ...payload, passwordHash },
  })
  return response.status(201).json({
    user,
    tempPassword,
  })
})

export const authRoutes = router
