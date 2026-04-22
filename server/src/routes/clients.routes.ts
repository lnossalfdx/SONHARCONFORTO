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
const CLIENT_SELECT =
  'id, name, phone, cpf, addressStreet, addressNumber, addressNeighborhood, addressCity, addressNote, createdAt'

router.get('/', async (request, response) => {
  const { search, start, end, city, sales, paginated } = request.query
  const normalizedSearch = typeof search === 'string' ? search.trim() : ''
  const limit = Number(request.query.limit)
  const offset = Number(request.query.offset)
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 200
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0
  const isPaginated = paginated === '1'
  const selectOptions = isPaginated ? { count: 'exact' as const } : undefined
  let query = supabase
    .from('clients')
    .select(CLIENT_SELECT, selectOptions)
    .order('createdAt', { ascending: false })
  if (isPaginated) {
    query = query.range(safeOffset, safeOffset + safeLimit - 1)
  }
  if (normalizedSearch) {
    const pattern = `%${normalizedSearch}%`
    query = query.or(`name.ilike.${pattern},phone.ilike.${pattern},cpf.ilike.${pattern}`)
  }
  if (typeof start === 'string') {
    query = query.gte('createdAt', start)
  }
  if (typeof end === 'string') {
    query = query.lte('createdAt', end)
  }
  if (typeof city === 'string' && city.trim()) {
    query = query.eq('addressCity', city.trim())
  }
  if (sales === 'with' || sales === 'without') {
    const { data: saleClients, error: salesError } = await supabase.from('sales').select('clientId')
    if (salesError) {
      return response.status(500).json({ message: salesError.message })
    }
    const clientIds = Array.from(
      new Set((saleClients ?? []).map((row) => row.clientId).filter((id): id is string => Boolean(id))),
    )
    if (sales === 'with') {
      if (!clientIds.length) {
        return response.json(isPaginated ? { data: [], total: 0 } : [])
      }
      query = query.in('id', clientIds)
    } else if (clientIds.length) {
      const value = `(${clientIds.map((id) => `"${id}"`).join(',')})`
      query = query.not('id', 'in', value)
    }
  }
  const { data, error, count } = await query
  if (error) {
    return response.status(500).json({ message: error.message })
  }
  if (isPaginated) {
    return response.json({ data: data ?? [], total: count ?? 0 })
  }
  return response.json(data ?? [])
})

router.post('/', async (request, response) => {
  const payload = clientSchema.parse(request.body)
  const { data, error } = await supabase.from('clients').insert(payload).select(CLIENT_SELECT).single()
  if (error || !data) {
    return response.status(400).json({ message: error?.message ?? 'Não foi possível criar cliente.' })
  }
  return response.status(201).json(data)
})

router.get('/:id', async (request, response) => {
  const { id } = request.params
  const { data, error } = await supabase
    .from('clients')
    .select(`${CLIENT_SELECT}, sales(id, publicId, value, status, createdAt)`)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return response.status(404).json({ message: 'Cliente não encontrado.' })
  return response.json(data)
})

router.put('/:id', async (request, response) => {
  const payload = clientSchema.partial().parse(request.body)
  const { id } = request.params
  const { data, error } = await supabase.from('clients').update(payload).eq('id', id).select(CLIENT_SELECT).single()
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
