import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'
import type { PaymentMethod, SaleStatus } from '../types.js'
import { supabase } from '../lib/supabase.js'

const router = Router()
router.use(authMiddleware)

const saleItemSchema = z
  .object({
    productId: z.string().min(5).optional(),
    customName: z.string().trim().min(2).optional(),
    customSku: z.string().trim().min(2).optional(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
    discount: z.number().nonnegative().default(0),
  })
  .refine(
    (data) => data.productId || data.customName,
    'Informe um produto válido ou descreva o item personalizado.',
  )

const paymentSchema = z.object({
    method: z.enum(['PIX', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro']),
    amount: z.number().nonnegative(),
    installments: z.number().int().positive().default(1),
  })

const dateSchema = z
  .string()
  .refine((value) => {
    if (!value) return true
    const timestamp = Date.parse(value)
    return !Number.isNaN(timestamp)
  }, 'Data inválida.')
  .optional()

const saleSchema = z.object({
  clientId: z.string().min(5),
  items: z.array(saleItemSchema).min(1),
  payments: z.array(paymentSchema).min(1),
  note: z.string().optional(),
  discount: z.number().nonnegative().default(0),
  deliveryDate: dateSchema,
})

type SaleItemInput = z.infer<typeof saleItemSchema>

const SALE_STATUS_PENDENTE: SaleStatus = 'pendente'
const SALE_STATUS_ENTREGUE: SaleStatus = 'entregue'
const SALE_STATUS_CANCELADA: SaleStatus = 'cancelada'

const isValidId = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.length > 0

const normalizeMethod = (method: string): PaymentMethod => {
  switch (method) {
    case 'Cartão de crédito':
      return 'CARTAO_CREDITO'
    case 'Cartão de débito':
      return 'CARTAO_DEBITO'
    case 'Dinheiro':
      return 'DINHEIRO'
    default:
      return 'PIX'
  }
}

const formatPublicId = (sequence: number) => `VEN-${String(sequence).padStart(4, '0')}`

const getNextSaleIdentifiers = async () => {
  const { data, error } = await supabase.rpc('increment_sale_sequence')
  if (error || typeof data !== 'number') {
    throw new Error(error?.message ?? 'Não foi possível gerar o número da venda.')
  }
  return {
    sequence: data,
    publicId: formatPublicId(data),
  }
}

const loadProducts = async (productIds: string[]) => {
  const uniqueIds = [...new Set(productIds)]
  if (!uniqueIds.length) return new Map<string, any>()
  const { data, error } = await supabase.from('products').select('*').in('id', uniqueIds)
  if (error) {
    throw new Error(error.message)
  }
  return new Map((data ?? []).map((product) => [product.id, product]))
}

const fetchSale = async (id: string) => {
  const { data, error } = await supabase
    .from('sales')
    .select(
      `
      *,
      client:clientId(*),
      items:sale_items(*, product:productId(*)),
      payments:sale_payments(*)
    `,
    )
    .eq('id', id)
    .single()
  if (error || !data) {
    throw new Error(error?.message ?? 'Venda não encontrada.')
  }
  return data
}

const validateStock = (items: SaleItemInput[], productMap: Map<string, any>) => {
  for (const item of items) {
    if (!item.productId) continue
    const product = productMap.get(item.productId)
    if (!product || product.quantity < item.quantity) {
      throw new Error(`Estoque insuficiente para ${product?.name ?? item.productId}.`)
    }
  }
}

const sumItems = (items: SaleItemInput[]) =>
  items.reduce((total, item) => total + item.quantity * item.unitPrice - (item.discount ?? 0), 0)

const toSaleItemsPayload = (saleId: string, items: SaleItemInput[]) =>
  items.map((item) => ({
    saleId,
    productId: item.productId ?? null,
    customName: item.customName ?? null,
    customSku: item.customSku ?? null,
    isCustom: !item.productId,
    requiresApproval: !item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount ?? 0,
  }))

const toPaymentPayload = (saleId: string, payments: z.infer<typeof paymentSchema>[]) =>
  payments.map((payment) => ({
    saleId,
    method: normalizeMethod(payment.method),
    amount: payment.amount,
    installments: payment.installments ?? 1,
  }))

const updateProductQuantities = async (
  items: SaleItemInput[],
  productMap: Map<string, any>,
  direction: 'reserve' | 'release' | 'deliver',
) => {
  for (const item of items) {
    if (!item.productId) continue
    const product = productMap.get(item.productId)
    if (!product) continue
    const updates: Record<string, number> = {}
    const currentQuantity = Number(product.quantity ?? 0)
    const currentReserved = Number(product.reserved ?? 0)
    if (direction === 'reserve') {
      updates.quantity = currentQuantity - item.quantity
      updates.reserved = currentReserved + item.quantity
      product.quantity = updates.quantity
      product.reserved = updates.reserved
    } else if (direction === 'release') {
      updates.quantity = currentQuantity + item.quantity
      updates.reserved = Math.max(0, currentReserved - item.quantity)
      product.quantity = updates.quantity
      product.reserved = updates.reserved
    } else if (direction === 'deliver') {
      updates.reserved = Math.max(0, currentReserved - item.quantity)
      product.reserved = updates.reserved
    }
    const { error } = await supabase.from('products').update(updates).eq('id', item.productId)
    if (error) {
      throw new Error(error.message)
    }
  }
}

router.get('/', async (request, response) => {
  const { status, clientId, search, start, end } = request.query
  let query = supabase
    .from('sales')
    .select(
      `
      *,
      client:clientId(*),
      items:sale_items(*, product:productId(*)),
      payments:sale_payments(*)
    `,
    )
    .order('createdAt', { ascending: false })

  if (typeof clientId === 'string') {
    query = query.eq('clientId', clientId)
  }
  if (typeof status === 'string' && ['pendente', 'entregue', 'cancelada'].includes(status)) {
    query = query.eq('status', status)
  }
  if (typeof start === 'string') {
    query = query.gte('createdAt', start)
  }
  if (typeof end === 'string') {
    query = query.lte('createdAt', end)
  }

  const { data, error } = await query
  if (error) {
    return response.status(500).json({ message: error.message })
  }
  const normalizedSearch = typeof search === 'string' ? search.trim().toLowerCase() : ''
  if (!normalizedSearch) {
    return response.json(data ?? [])
  }
  const filtered = (data ?? []).filter((sale) => {
    const clientName = sale.client?.name ?? ''
    return (
      String(sale.publicId ?? sale.id).toLowerCase().includes(normalizedSearch) ||
      clientName.toLowerCase().includes(normalizedSearch)
    )
  })
  return response.json(filtered)
})

router.post('/', async (request, response) => {
  const payload = saleSchema.parse(request.body)
  const { data: client, error: clientError } = await supabase.from('clients').select('id').eq('id', payload.clientId).single()
  if (clientError || !client) {
    return response.status(404).json({ message: 'Cliente não encontrado.' })
  }

  const productIds = [...new Set(payload.items.map((item) => item.productId).filter(isValidId))]
  let productsMap: Map<string, any>
  try {
    productsMap = await loadProducts(productIds)
  } catch (error) {
    return response.status(500).json({ message: (error as Error).message })
  }
  try {
    validateStock(payload.items, productsMap)
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }

  const itemsTotal = sumItems(payload.items)
  const orderTotal = itemsTotal - payload.discount
  const paymentsTotal = payload.payments.reduce((sum, payment) => sum + payment.amount, 0)
  if (Math.abs(paymentsTotal - orderTotal) > 0.01) {
    return response.status(400).json({ message: 'Pagamentos não conferem com o total do pedido.' })
  }
  const requiresApproval = payload.items.some((item) => !item.productId)
  const deliveryDate = payload.deliveryDate ? new Date(payload.deliveryDate).toISOString() : null
  let identifiers: { sequence: number; publicId: string }
  try {
    identifiers = await getNextSaleIdentifiers()
  } catch (error) {
    return response.status(500).json({ message: (error as Error).message })
  }

  const { data: createdSale, error: saleError } = await supabase
    .from('sales')
    .insert({
      clientId: payload.clientId,
      createdById: request.user?.id ?? null,
      discount: payload.discount,
      note: payload.note ?? null,
      deliveryDate,
      value: orderTotal,
      requiresApproval,
      status: SALE_STATUS_PENDENTE,
      publicId: identifiers.publicId,
      sequence: identifiers.sequence,
    })
    .select('*')
    .single()
  if (saleError || !createdSale) {
    return response.status(400).json({ message: saleError?.message ?? 'Não foi possível criar a venda.' })
  }

  const saleId = createdSale.id
  const { error: itemsError } = await supabase.from('sale_items').insert(toSaleItemsPayload(saleId, payload.items))
  if (itemsError) {
    return response.status(400).json({ message: itemsError.message })
  }
  const { error: paymentsError } = await supabase.from('sale_payments').insert(toPaymentPayload(saleId, payload.payments))
  if (paymentsError) {
    return response.status(400).json({ message: paymentsError.message })
  }

  try {
    await updateProductQuantities(payload.items, productsMap, 'reserve')
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }

  const sale = await fetchSale(saleId)
  return response.status(201).json(sale)
})

router.post('/:id/confirm-delivery', roleGuard(['admin', 'seller']), async (request, response) => {
  const { id } = request.params
  let sale
  try {
    sale = await fetchSale(id)
  } catch (error) {
    return response.status(404).json({ message: (error as Error).message })
  }
  if (sale.requiresApproval) {
    return response.status(400).json({ message: 'Este pedido possui itens aguardando aprovação do administrador.' })
  }
  if (sale.status === SALE_STATUS_CANCELADA) {
    return response.status(400).json({ message: 'Este pedido foi cancelado.' })
  }
  if (sale.status === SALE_STATUS_ENTREGUE) {
    return response.json(sale)
  }

  const productIds = sale.items.map((item: any) => item.productId).filter(isValidId)
  let productsMap: Map<string, any>
  try {
    productsMap = await loadProducts(productIds)
  } catch (error) {
    return response.status(500).json({ message: (error as Error).message })
  }
  try {
    await updateProductQuantities(
      sale.items.map((item: any) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        customName: item.customName,
        customSku: item.customSku,
      })),
      productsMap,
      'deliver',
    )
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }

  const { error } = await supabase.from('sales').update({ status: SALE_STATUS_ENTREGUE }).eq('id', id)
  if (error) {
    return response.status(400).json({ message: error.message })
  }
  const updated = await fetchSale(id)
  return response.json(updated)
})

router.get('/:id', async (request, response) => {
  const { id } = request.params
  try {
    const sale = await fetchSale(id)
    return response.json(sale)
  } catch (error) {
    return response.status(404).json({ message: (error as Error).message })
  }
})

router.put('/:id', roleGuard('admin'), async (request, response) => {
  const payload = saleSchema.parse(request.body)
  const { id } = request.params
  let sale
  try {
    sale = await fetchSale(id)
  } catch (error) {
    return response.status(404).json({ message: (error as Error).message })
  }
  if (sale.status === SALE_STATUS_ENTREGUE) {
    return response.status(400).json({ message: 'Não é possível editar um pedido entregue.' })
  }
  if (sale.status === SALE_STATUS_CANCELADA) {
    return response.status(400).json({ message: 'Não é possível editar um pedido cancelado.' })
  }

  const productIds = [...new Set(payload.items.map((item) => item.productId).filter(isValidId))]
  let productsMap: Map<string, any>
  try {
    productsMap = await loadProducts(productIds)
  } catch (error) {
    return response.status(500).json({ message: (error as Error).message })
  }
  try {
    validateStock(payload.items, productsMap)
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }

  const itemsTotal = sumItems(payload.items)
  const orderTotal = itemsTotal - payload.discount
  const paymentsTotal = payload.payments.reduce((sum, payment) => sum + payment.amount, 0)
  if (Math.abs(orderTotal - paymentsTotal) > 0.01) {
    return response.status(400).json({ message: 'Pagamentos não conferem com o total do pedido.' })
  }

  const releaseItems: SaleItemInput[] = sale.items.map((item: any) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
    customName: item.customName,
    customSku: item.customSku,
  }))
  const requiresApproval = payload.items.some((item) => !item.productId)
  try {
    const releaseMap = await loadProducts(releaseItems.map((item) => item.productId).filter(isValidId))
    await updateProductQuantities(releaseItems, releaseMap, 'release')
    await updateProductQuantities(payload.items, productsMap, 'reserve')
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }

  await supabase.from('sale_items').delete().eq('saleId', id)
  await supabase.from('sale_payments').delete().eq('saleId', id)

  const { error: itemsError } = await supabase.from('sale_items').insert(toSaleItemsPayload(id, payload.items))
  if (itemsError) {
    return response.status(400).json({ message: itemsError.message })
  }
  const { error: paymentsError } = await supabase.from('sale_payments').insert(toPaymentPayload(id, payload.payments))
  if (paymentsError) {
    return response.status(400).json({ message: paymentsError.message })
  }

  const { error: updateError } = await supabase
    .from('sales')
    .update({
      clientId: payload.clientId,
      discount: payload.discount,
      note: payload.note ?? null,
      deliveryDate: payload.deliveryDate ? new Date(payload.deliveryDate).toISOString() : null,
      value: orderTotal,
      status: SALE_STATUS_PENDENTE,
      requiresApproval,
    })
    .eq('id', id)
  if (updateError) {
    return response.status(400).json({ message: updateError.message })
  }
  const updatedSale = await fetchSale(id)
  return response.json(updatedSale)
})

router.post('/:id/cancel', roleGuard('admin'), async (request, response) => {
  const { id } = request.params
  let sale
  try {
    sale = await fetchSale(id)
  } catch (error) {
    return response.status(404).json({ message: (error as Error).message })
  }
  if (sale.status === SALE_STATUS_ENTREGUE) {
    return response.status(400).json({ message: 'Não é possível cancelar um pedido entregue.' })
  }
  if (sale.status === SALE_STATUS_CANCELADA) {
    return response.json(sale)
  }

  const releaseItems: SaleItemInput[] = sale.items.map((item: any) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
    customName: item.customName,
    customSku: item.customSku,
  }))
  try {
    const releaseMap = await loadProducts(releaseItems.map((item) => item.productId).filter(isValidId))
    await updateProductQuantities(releaseItems, releaseMap, 'release')
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }

  const { error } = await supabase.from('sales').update({ status: SALE_STATUS_CANCELADA }).eq('id', id)
  if (error) {
    return response.status(400).json({ message: error.message })
  }
  const updated = await fetchSale(id)
  return response.json(updated)
})

router.post('/:id/approve', roleGuard('admin'), async (request, response) => {
  const { id } = request.params
  let sale
  try {
    sale = await fetchSale(id)
  } catch (error) {
    return response.status(404).json({ message: (error as Error).message })
  }
  if (!sale.requiresApproval) {
    return response.status(400).json({ message: 'Este pedido já foi aprovado.' })
  }
  const { error } = await supabase
    .from('sales')
    .update({ requiresApproval: false })
    .eq('id', id)
  if (error) {
    return response.status(400).json({ message: error.message })
  }
  await supabase.from('sale_items').update({ requiresApproval: false }).eq('saleId', id)
  const updated = await fetchSale(id)
  return response.json(updated)
})

export const salesRoutes = router
