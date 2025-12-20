import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()
router.use(authMiddleware)

const clientSchema = z.object({
  name: z.string().min(3),
  phone: z.string().optional(),
  cpf: z.string().optional(),
  addressStreet: z.string().optional(),
  addressNumber: z.string().optional(),
  addressNeighborhood: z.string().optional(),
  addressCity: z.string().optional(),
  addressNote: z.string().optional(),
})

router.get('/', async (request, response) => {
  const { search } = request.query
  const normalizedSearch = typeof search === 'string' ? search.trim() : ''
  let query = supabase.from('clients').select('*').order('createdAt', { ascending: false })
  if (normalizedSearch) {
    const pattern = `%${normalizedSearch}%`
    query = query.or(`name.ilike.${pattern},phone.ilike.${pattern},cpf.ilike.${pattern}`)
  }
  const { data, error } = await query
  if (error) {
    return response.status(500).json({ message: error.message })
  }
  return response.json(data ?? [])
})

router.post('/', async (request, response) => {
  const payload = clientSchema.parse(request.body)
  const { data, error } = await supabase.from('clients').insert(payload).select('*').single()
  if (error || !data) {
    return response.status(400).json({ message: error?.message ?? 'Não foi possível criar cliente.' })
  }
  return response.status(201).json(data)
})

router.get('/:id', async (request, response) => {
  const { id } = request.params
  const { data, error } = await supabase
    .from('clients')
    .select('*, sales(*)')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return response.status(404).json({ message: 'Cliente não encontrado.' })
  return response.json(data)
})

router.put('/:id', async (request, response) => {
  const payload = clientSchema.partial().parse(request.body)
  const { id } = request.params
  const { data, error } = await supabase.from('clients').update(payload).eq('id', id).select('*').single()
  if (error || !data) {
    return response.status(404).json({ message: error?.message ?? 'Cliente não encontrado.' })
  }
  return response.json(data)
})

router.delete('/:id', async (request, response) => {
  const { id } = request.params
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) {
    return response.status(400).json({ message: error.message })
  }
  return response.status(204).send()
})

export const clientRoutes = router
