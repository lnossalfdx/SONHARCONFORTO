import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

const sanitizeProductFactoryCost = <T extends { factoryCost?: number }>(product: T, expose: boolean) => {
  if (!product || expose) return product
  const clone: T & { factoryCost?: number } = { ...product }
  delete clone.factoryCost
  return clone
}

const productSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do produto.'),
  sku: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return undefined
      const trimmed = value.trim()
      return trimmed.length ? trimmed : undefined
    },
    z.string().min(2).optional(),
  ),
  price: z.number().nonnegative(),
  factoryCost: z.number().nonnegative().default(0),
  quantity: z.number().int().nonnegative().default(0),
  imageUrl: z.string().url().optional(),
})

const updateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  price: z.number().nonnegative().optional(),
  factoryCost: z.number().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
})

const generateSku = () => `SKU-${Math.floor(Math.random() * 90000 + 10000)}`
const PRODUCT_SELECT = 'id, name, sku, quantity, reserved, price, factoryCost, imageUrl'

router.get('/', authMiddleware, async (request, response) => {
  const { search, filter, minPrice, maxPrice, paginated } = request.query
  const normalizedSearch = typeof search === 'string' ? search.trim() : ''
  const limit = Number(request.query.limit)
  const offset = Number(request.query.offset)
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 200
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0
  const isPaginated = paginated === '1'
  const selectOptions = isPaginated ? { count: 'exact' as const } : undefined
  let query = supabase
    .from('products')
    .select(PRODUCT_SELECT, selectOptions)
    .order('createdAt', { ascending: false })
  if (isPaginated) {
    query = query.range(safeOffset, safeOffset + safeLimit - 1)
  }
  if (normalizedSearch) {
    const pattern = `%${normalizedSearch}%`
    query = query.or(`name.ilike.${pattern},sku.ilike.${pattern}`)
  }
  if (filter === 'low') {
    query = query.lte('quantity', 3)
  }
  if (filter === 'reserved') {
    query = query.gt('reserved', 0)
  }
  const minValueNumber = typeof minPrice === 'string' ? Number(minPrice) : null
  const maxValueNumber = typeof maxPrice === 'string' ? Number(maxPrice) : null
  if (minValueNumber !== null && !Number.isNaN(minValueNumber)) {
    query = query.gte('price', minValueNumber)
  }
  if (maxValueNumber !== null && !Number.isNaN(maxValueNumber)) {
    query = query.lte('price', maxValueNumber)
  }
  const { data: products, error, count } = await query
  if (error) {
    return response.status(500).json({ message: error.message })
  }
  const payload = products?.map((product) => sanitizeProductFactoryCost(product, request.user?.role === 'admin')) ?? []
  if (isPaginated) {
    return response.json({ data: payload, total: count ?? 0 })
  }
  return response.json(payload)
})

router.post('/', authMiddleware, roleGuard('admin'), async (request, response) => {
  const payload = productSchema.parse(request.body)
  const { sku, ...rest } = payload
  const normalizedSku = sku ?? generateSku()
  const { data, error } = await supabase
    .from('products')
    .insert({ ...rest, sku: normalizedSku, reserved: 0 })
    .select(PRODUCT_SELECT)
    .single()
  if (error || !data) {
    return response.status(400).json({ message: error?.message ?? 'Não foi possível criar produto.' })
  }
  return response.status(201).json(data)
})

router.put('/:id', authMiddleware, roleGuard('admin'), async (request, response) => {
  const payload = updateSchema.parse(request.body)
  const { id } = request.params
  const { data, error } = await supabase.from('products').update(payload).eq('id', id).select(PRODUCT_SELECT).single()
  if (error || !data) {
    return response.status(404).json({ message: error?.message ?? 'Produto não encontrado.' })
  }
  return response.json(data)
})

const movementSchema = z.object({
  type: z.enum(['entrada', 'saida']),
  amount: z.number().int().positive(),
  note: z.string().optional(),
})

router.post('/:id/movements', authMiddleware, roleGuard('admin'), async (request, response) => {
  const payload = movementSchema.parse(request.body)
  const { id } = request.params
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, quantity')
    .eq('id', id)
    .single()
  if (productError || !product) return response.status(404).json({ message: 'Produto não encontrado.' })

  if (payload.type === 'saida' && product.quantity < payload.amount) {
    return response.status(400).json({ message: 'Quantidade em estoque insuficiente para saída.' })
  }

  const delta = payload.type === 'entrada' ? payload.amount : -payload.amount
  const nextQuantity = product.quantity + delta
  const { data: updated, error: updateError } = await supabase
    .from('products')
    .update({ quantity: nextQuantity })
    .eq('id', id)
    .select(PRODUCT_SELECT)
    .single()
  if (updateError || !updated) {
    return response.status(400).json({ message: updateError?.message ?? 'Falha ao atualizar estoque.' })
  }
  const { error: movementError } = await supabase.from('stock_movements').insert({
    productId: id,
    userId: request.user!.id,
    type: payload.type,
    amount: payload.amount,
    note: payload.note ?? null,
  })
  if (movementError) {
    return response.status(400).json({ message: movementError.message })
  }

  return response.json(updated)
})

router.get('/movements', authMiddleware, async (request, response) => {
  const { type } = request.query
  const limit = Number(request.query.limit)
  const offset = Number(request.query.offset)
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 200
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0
  let query = supabase
    .from('stock_movements')
    .select('id, productId, type, amount, note, createdAt')
    .order('createdAt', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1)
  if (type === 'entrada' || type === 'saida') {
    query = query.eq('type', type)
  }
  const { data: movements, error } = await query
  if (error) {
    return response.status(500).json({ message: error.message })
  }
  return response.json(movements ?? [])
})

router.delete('/:id', authMiddleware, roleGuard('admin'), async (request, response) => {
  const { id } = request.params
  const { data: product, error } = await supabase
    .from('products')
    .select('id, quantity, reserved')
    .eq('id', id)
    .single()
  if (error || !product) return response.status(404).json({ message: 'Produto não encontrado.' })
  if ((product.quantity ?? 0) > 0 || (product.reserved ?? 0) > 0) {
    return response.status(400).json({ message: 'Só é possível remover produtos zerados.' })
  }
  const { error: deleteError } = await supabase.from('products').delete().eq('id', id)
  if (deleteError) {
    return response.status(400).json({ message: deleteError.message })
  }
  return response.status(204).send()
})

export const stockRoutes = router
