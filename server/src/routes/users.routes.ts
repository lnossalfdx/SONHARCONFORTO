import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

router.use(authMiddleware, roleGuard('admin'))

router.get('/', async (_request, response) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, phone, role, active, createdAt')
    .order('createdAt', { ascending: false })
  if (error) {
    return response.status(500).json({ message: error.message })
  }
  return response.json(data ?? [])
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
  const updateData: Record<string, unknown> = {}
  if (payload.name !== undefined) updateData.name = payload.name
  if (payload.phone !== undefined) updateData.phone = payload.phone
  if (payload.role !== undefined) updateData.role = payload.role
  if (payload.active !== undefined) updateData.active = payload.active
  const { data, error } = await supabase
    .from('users')
    .update(updateData)
    .eq('id', id)
    .select('id, name, email, phone, role, active')
    .single()
  if (error || !data) {
    return response.status(404).json({ message: error?.message ?? 'Usuário não encontrado.' })
  }
  return response.json(data)
})

router.delete('/:id', async (request, response) => {
  const { id } = request.params
  const { error } = await supabase.from('users').delete().eq('id', id)
  if (error) {
    return response.status(404).json({ message: error.message })
  }
  await supabase.auth.admin.deleteUser(id)
  return response.status(204).send()
})

router.post('/:id/reset-password', async (request, response) => {
  const { id } = request.params
  const newPassword = `crm-${Math.random().toString(36).slice(2, 8)}`
  const { error } = await supabase.auth.admin.updateUserById(id, { password: newPassword })
  if (error) {
    return response.status(400).json({ message: error.message })
  }
  return response.json({ message: 'Senha redefinida.', temporaryPassword: newPassword })
})

export const userRoutes = router
