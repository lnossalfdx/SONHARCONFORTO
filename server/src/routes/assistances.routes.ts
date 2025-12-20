import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()
router.use(authMiddleware)

const assistanceSchema = z.object({
  saleId: z.string().min(5),
  productId: z.string().min(5),
  defectDescription: z.string().min(5),
  factoryResponse: z.string().optional(),
  expectedDate: z.string().datetime().optional(),
  photos: z.array(z.string()).max(4).optional(),
  notes: z.string().optional(),
})

const statusSchema = z.object({ status: z.enum(['aberta', 'concluida']), factoryResponse: z.string().optional() })

const randomCode = () => `AST-${Math.floor(Math.random() * 900 + 100)}`

router.get('/', async (request, response) => {
  const { status, search } = request.query
  let query = supabase
    .from('assistances')
    .select('*, sale:saleId(*), product:productId(*), owner:ownerId(*)')
    .order('createdAt', { ascending: false })
  if (status === 'concluida' || status === 'aberta') {
    query = query.eq('status', status)
  }
  const normalizedSearch = typeof search === 'string' ? search.trim().toLowerCase() : ''
  const { data, error } = await query
  if (error) {
    return response.status(500).json({ message: error.message })
  }
  if (!normalizedSearch) {
    return response.json(data ?? [])
  }
  const filtered = (data ?? []).filter((assist) => {
    const saleCode = assist.sale?.publicId ?? ''
    const productName = assist.product?.name ?? ''
    return (
      assist.code.toLowerCase().includes(normalizedSearch) ||
      saleCode.toLowerCase().includes(normalizedSearch) ||
      productName.toLowerCase().includes(normalizedSearch)
    )
  })
  return response.json(filtered)
})

router.post('/', async (request, response) => {
  const payload = assistanceSchema.parse(request.body)
  const { data: sale, error: saleError } = await supabase.from('sales').select('id').eq('id', payload.saleId).single()
  if (saleError || !sale) return response.status(404).json({ message: 'Venda não encontrada.' })
  const { data, error } = await supabase
    .from('assistances')
    .insert({
      code: randomCode(),
      saleId: payload.saleId,
      productId: payload.productId,
      defectDescription: payload.defectDescription,
      factoryResponse: payload.factoryResponse ?? null,
      expectedDate: payload.expectedDate ? new Date(payload.expectedDate).toISOString() : null,
      photos: payload.photos ?? [],
      notes: payload.notes ?? null,
      ownerId: request.user?.id ?? null,
    })
    .select('*, sale:saleId(*), product:productId(*), owner:ownerId(*)')
    .single()
  if (error || !data) {
    return response.status(400).json({ message: error?.message ?? 'Não foi possível cadastrar assistência.' })
  }
  return response.status(201).json(data)
})

router.patch('/:id/status', async (request, response) => {
  const payload = statusSchema.parse(request.body)
  const { id } = request.params
  const { data, error } = await supabase
    .from('assistances')
    .update({ status: payload.status, factoryResponse: payload.factoryResponse ?? null })
    .eq('id', id)
    .select('*, sale:saleId(*), product:productId(*), owner:ownerId(*)')
    .single()
  if (error || !data) {
    return response.status(404).json({ message: error?.message ?? 'Assistência não encontrada.' })
  }
  return response.json(data)
})

router.get('/:id', async (request, response) => {
  const { id } = request.params
  const { data, error } = await supabase
    .from('assistances')
    .select('*, sale:saleId(*), product:productId(*), owner:ownerId(*)')
    .eq('id', id)
    .single()
  if (error || !data) return response.status(404).json({ message: 'Assistência não encontrada.' })
  return response.json(data)
})

export const assistanceRoutes = router
