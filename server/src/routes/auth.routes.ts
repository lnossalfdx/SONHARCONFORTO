import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

router.post('/login', async (request, response) => {
  const credentials = loginSchema.parse(request.body)
  const { data, error } = await supabase.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  })
  if (error || !data.session || !data.user) {
    return response.status(401).json({ message: 'Credenciais inválidas.' })
  }
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, name, email, role, phone, active')
    .eq('id', data.user.id)
    .single()
  if (profileError || !profile) {
    return response.status(403).json({ message: 'Perfil não localizado.' })
  }
  if (profile.active === false) {
    return response.status(403).json({ message: 'Usuário desativado.' })
  }
  return response.json({
    token: data.session.access_token,
    user: profile,
  })
})

router.get('/me', authMiddleware, async (request, response) => {
  const { data: me, error } = await supabase
    .from('users')
    .select('id, name, email, phone, role, active')
    .eq('id', request.user!.id)
    .single()
  if (error || !me) {
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
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', payload.email)
    .maybeSingle()
  if (existing) {
    return response.status(400).json({ message: 'E-mail já está em uso.' })
  }
  const tempPassword = `crm-${Math.random().toString(36).slice(2, 8)}`
  const { data: createdUser, error: authError } = await supabase.auth.admin.createUser({
    email: payload.email,
    password: tempPassword,
    email_confirm: true,
  })
  if (authError || !createdUser.user) {
    return response.status(400).json({ message: authError?.message ?? 'Não foi possível criar usuário.' })
  }
  const { data: user, error: insertError } = await supabase
    .from('users')
    .insert({
      id: createdUser.user.id,
      name: payload.name,
      email: payload.email,
      phone: payload.phone ?? null,
      role: payload.role,
      active: true,
      passwordHash: 'supabase-managed',
    })
    .select('id, name, email, role, phone, active')
    .single()
  if (insertError || !user) {
    return response.status(500).json({ message: insertError?.message ?? 'Falha ao salvar perfil.' })
  }
  return response.status(201).json({
    user,
    tempPassword,
  })
})

export const authRoutes = router
