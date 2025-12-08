import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'
import { hashPassword } from '../utils/password.js'

const router = Router()

router.use(authMiddleware, roleGuard('admin'))

router.get('/', async (_request, response) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } })
  return response.json(users)
})

const updateSchema = z.object({
  name: z.string().min(3).optional(),
  phone: z.string().optional(),
  role: z.enum(['admin', 'seller']).optional(),
  active: z.boolean().optional(),
})

router.patch('/:id', async (request, response) => {
  const payload = updateSchema.parse(request.body)
  const { id } = request.params
  const user = await prisma.user.update({ where: { id }, data: payload })
  return response.json(user)
})

router.delete('/:id', async (request, response) => {
  const { id } = request.params
  await prisma.user.delete({ where: { id } })
  return response.status(204).send()
})

router.post('/:id/reset-password', async (request, response) => {
  const { id } = request.params
  const newPassword = `crm-${Math.random().toString(36).slice(2, 8)}`
  const passwordHash = await hashPassword(newPassword)
  await prisma.user.update({ where: { id }, data: { passwordHash } })
  return response.json({ message: 'Senha redefinida.', temporaryPassword: newPassword })
})

export const userRoutes = router
