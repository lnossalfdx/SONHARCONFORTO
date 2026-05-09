import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()
router.use(authMiddleware)

const assistanceSchema = z.object({
  saleId: z.string().min(5),
  productId: z.string().min(5).optional(),
  defectDescription: z.string().min(5),
  factoryResponse: z.string().optional(),
  expectedDate: z.string().datetime().optional(),
  photos: z.array(z.string()).max(4).optional(),
  notes: z.string().optional(),
})

const statusSchema = z.object({ status: z.enum(['aberta', 'concluida']), factoryResponse: z.string().optional() })

const randomCode = () => `AST-${Math.floor(Math.random() * 900 + 100)}`
const ASSISTANCE_SELECT =
  'id, code, saleId, productId, defectDescription, factoryResponse, expectedDate, status, createdAt, photos'
const ASSISTANCE_RELATIONS = 'sale:saleId(id, publicId), product:productId(id, name), owner:ownerId(id, name)'
const ASSISTANCE_FULL_SELECT = `${ASSISTANCE_SELECT}, ${ASSISTANCE_RELATIONS}`

router.get('/', async (request, response) => {
  const { status, search } = request.query
  let query = supabase
    .from('assistances')
    .select(ASSISTANCE_FULL_SELECT)
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
    const saleRecord = Array.isArray(assist.sale) ? assist.sale[0] : assist.sale
    const productRecord = Array.isArray(assist.product) ? assist.product[0] : assist.product
    const saleCode = saleRecord?.publicId ?? ''
    const productName = productRecord?.name ?? ''
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
      productId: payload.productId ?? null,
      defectDescription: payload.defectDescription,
      factoryResponse: payload.factoryResponse ?? null,
      expectedDate: payload.expectedDate ? new Date(payload.expectedDate).toISOString() : null,
      photos: payload.photos ?? [],
      notes: payload.notes ?? null,
      ownerId: request.user?.id ?? null,
    })
    .select(ASSISTANCE_FULL_SELECT)
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
    .select(ASSISTANCE_FULL_SELECT)
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
    .select(ASSISTANCE_FULL_SELECT)
    .eq('id', id)
    .single()
  if (error || !data) return response.status(404).json({ message: 'Assistência não encontrada.' })
  return response.json(data)
})

export const assistanceRoutes = router
