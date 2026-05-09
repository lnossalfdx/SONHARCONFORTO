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

const receiptSchema = z.object({
  imageData: z.union([z.string().min(10), z.array(z.string().min(10)).min(1)]),
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

const validateImageDataUrl = (value: string) => {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) {
    throw new Error('Formato de imagem inválido.')
  }
  if (match[2].length < 16) {
    throw new Error('Arquivo de imagem inválido.')
  }
}

const normalizeReceiptImages = (value: unknown): string[] => {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
        }
      } catch (error) {
        console.warn('Falha ao interpretar comprovantes armazenados:', error)
      }
    }
    return [value]
  }
  return []
}

const serializeReceiptImages = (images: string[]) => {
  if (images.length <= 1) {
    return images[0] ?? null
  }
  return JSON.stringify(images)
}

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

const SALE_ITEM_SELECT =
  'id, saleId, productId, customName, customSku, requiresApproval, quantity, unitPrice, discount, product:productId(id, name)'
const SALE_PAYMENT_SELECT = 'id, method, amount, installments'
const SALE_SELECT_LIST = `
  id,
  publicId,
  clientId,
  value,
  discount,
  note,
  status,
  requiresApproval,
  createdAt,
  deliveryDate,
  client:clientId(id, name),
  items:sale_items(${SALE_ITEM_SELECT}),
  payments:sale_payments(${SALE_PAYMENT_SELECT})
`
const SALE_SELECT_DETAIL = `
  id,
  publicId,
  clientId,
  value,
  discount,
  note,
  status,
  requiresApproval,
  createdAt,
  deliveryDate,
  receiptImage,
  client:clientId(id, name),
  items:sale_items(${SALE_ITEM_SELECT}),
  payments:sale_payments(${SALE_PAYMENT_SELECT})
`

const loadProducts = async (productIds: string[]) => {
  const uniqueIds = [...new Set(productIds)]
  if (!uniqueIds.length) return new Map<string, any>()
  const { data, error } = await supabase
    .from('products')
    .select('id, name, price, quantity, reserved')
    .in('id', uniqueIds)
  if (error) {
    throw new Error(error.message)
  }
  return new Map((data ?? []).map((product) => [product.id, product]))
}

const enforceSellerMinimumPrices = (
  items: SaleItemInput[],
  productMap: Map<string, any>,
  enforce: boolean,
) => {
  if (!enforce) return items
  for (const item of items) {
    if (!item.productId) continue
    const product = productMap.get(item.productId)
    if (!product) continue
    const price = Number(product.price ?? 0)
    const minimumPrice = Number.isFinite(price) ? price : 0
    if (item.unitPrice < minimumPrice) {
      throw new Error(`Preço de ${product.name ?? item.productId} não pode ficar abaixo do cadastrado.`)
    }
  }
  return items
}

const recordStockMovement = async (
  productId: string,
  userId: string | null | undefined,
  type: 'entrada' | 'saida',
  amount: number,
  note: string,
) => {
  if (!amount || amount <= 0) return
  const { error } = await supabase.from('stock_movements').insert({
    productId,
    userId: userId ?? null,
    type,
    amount,
    note,
  })
  if (error) {
    throw new Error(error.message)
  }
}

const fetchSale = async (id: string) => {
  const { data, error } = await supabase
    .from('sales')
    .select(SALE_SELECT_DETAIL)
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

const sumQuantitiesByProductId = (items: Array<{ productId?: string | null; quantity: number }>) => {
  const totals = new Map<string, number>()
  for (const item of items) {
    if (!isValidId(item.productId)) continue
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity)
  }
  return totals
}

const validateStockDelta = (
  items: SaleItemInput[],
  productMap: Map<string, any>,
  previousItems: Array<{ productId?: string | null; quantity: number }>,
) => {
  const previousTotals = sumQuantitiesByProductId(previousItems)
  const nextTotals = sumQuantitiesByProductId(items)
  const productIds = new Set([...previousTotals.keys(), ...nextTotals.keys()])
  for (const productId of productIds) {
    const product = productMap.get(productId)
    if (!product) {
      throw new Error(`Produto não encontrado para ${productId}.`)
    }
    const previousQuantity = previousTotals.get(productId) ?? 0
    const nextQuantity = nextTotals.get(productId) ?? 0
    const additionalQuantityNeeded = Math.max(0, nextQuantity - previousQuantity)
    if (Number(product.quantity ?? 0) < additionalQuantityNeeded) {
      throw new Error(`Estoque insuficiente para ${product?.name ?? productId}.`)
    }
  }
}

const loadPendingReservedQuantities = async (productIds: string[], excludeSaleId: string) => {
  const uniqueProductIds = [...new Set(productIds.filter(isValidId))]
  if (!uniqueProductIds.length) return new Map<string, number>()

  const { data: pendingSales, error: pendingSalesError } = await supabase
    .from('sales')
    .select('id')
    .eq('status', SALE_STATUS_PENDENTE)
    .neq('id', excludeSaleId)

  if (pendingSalesError) {
    throw new Error(pendingSalesError.message)
  }

  const pendingSaleIds = (pendingSales ?? []).map((sale) => sale.id).filter(isValidId)
  if (!pendingSaleIds.length) return new Map<string, number>()

  const { data: pendingItems, error: pendingItemsError } = await supabase
    .from('sale_items')
    .select('productId, quantity')
    .in('saleId', pendingSaleIds)
    .in('productId', uniqueProductIds)

  if (pendingItemsError) {
    throw new Error(pendingItemsError.message)
  }

  return sumQuantitiesByProductId(pendingItems ?? [])
}

const updateDeliveredProductQuantities = async (
  previousItems: Array<{ productId?: string | null; quantity: number }>,
  nextItems: SaleItemInput[],
  productMap: Map<string, any>,
  userId: string | null | undefined,
  saleLabel: string,
) => {
  const previousTotals = sumQuantitiesByProductId(previousItems)
  const nextTotals = sumQuantitiesByProductId(nextItems)
  const productIds = new Set([...previousTotals.keys(), ...nextTotals.keys()])
  for (const productId of productIds) {
    const previousQuantity = previousTotals.get(productId) ?? 0
    const nextQuantity = nextTotals.get(productId) ?? 0
    const delta = nextQuantity - previousQuantity
    if (!delta) continue
    const product = productMap.get(productId)
    if (!product) continue
    const currentQuantity = Number(product.quantity ?? 0)
    const nextProductQuantity = currentQuantity - delta
    if (nextProductQuantity < 0) {
      throw new Error(`Estoque insuficiente para ${product?.name ?? productId}.`)
    }
    const { error } = await supabase.from('products').update({ quantity: nextProductQuantity }).eq('id', productId)
    if (error) {
      throw new Error(error.message)
    }
    await recordStockMovement(
      productId,
      userId,
      delta > 0 ? 'saida' : 'entrada',
      Math.abs(delta),
      delta > 0 ? `Ajuste de venda entregue ${saleLabel}` : `Devolução por ajuste de venda entregue ${saleLabel}`,
    )
    product.quantity = nextProductQuantity
  }
}

const updatePendingProductQuantities = async (
  saleId: string,
  previousItems: Array<{ productId?: string | null; quantity: number }>,
  nextItems: SaleItemInput[],
  productMap: Map<string, any>,
  userId: string | null | undefined,
  saleLabel: string,
) => {
  const previousTotals = sumQuantitiesByProductId(previousItems)
  const nextTotals = sumQuantitiesByProductId(nextItems)
  const productIds = [...new Set([...previousTotals.keys(), ...nextTotals.keys()])]
  const otherReservedTotals = await loadPendingReservedQuantities(productIds, saleId)

  for (const productId of productIds) {
    const product = productMap.get(productId)
    if (!product) {
      throw new Error(`Produto não encontrado para ${productId}.`)
    }

    const currentQuantity = Number(product.quantity ?? 0)
    const currentReserved = Number(product.reserved ?? 0)
    const totalStock = currentQuantity + currentReserved
    const nextReservedQuantity = (otherReservedTotals.get(productId) ?? 0) + (nextTotals.get(productId) ?? 0)
    const nextProductQuantity = totalStock - nextReservedQuantity

    if (nextProductQuantity < 0) {
      throw new Error(`Estoque insuficiente para ${product?.name ?? productId}.`)
    }

    const { error } = await supabase
      .from('products')
      .update({
        quantity: nextProductQuantity,
        reserved: nextReservedQuantity,
      })
      .eq('id', productId)

    if (error) {
      throw new Error(error.message)
    }

    const quantityDelta = nextProductQuantity - currentQuantity
    if (quantityDelta !== 0) {
      await recordStockMovement(
        productId,
        userId,
        quantityDelta > 0 ? 'entrada' : 'saida',
        Math.abs(quantityDelta),
        quantityDelta > 0 ? `Devolução por ajuste da venda ${saleLabel}` : `Saída por ajuste da venda ${saleLabel}`,
      )
    }

    product.quantity = nextProductQuantity
    product.reserved = nextReservedQuantity
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
  userId?: string | null,
  movementNote?: string,
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
    if (direction === 'reserve') {
      await recordStockMovement(item.productId, userId, 'saida', item.quantity, movementNote ?? 'Saída por venda')
    } else if (direction === 'release') {
      await recordStockMovement(item.productId, userId, 'entrada', item.quantity, movementNote ?? 'Entrada por cancelamento de venda')
    }
  }
}

router.get('/', async (request, response) => {
  const { status, clientId, search, start, end, method, minValue, paginated } = request.query
  const limit = Number(request.query.limit)
  const offset = Number(request.query.offset)
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 200
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0
  const isPaginated = paginated === '1'
  const selectOptions = isPaginated ? { count: 'exact' as const } : undefined
  let query = supabase
    .from('sales')
    .select(SALE_SELECT_LIST, selectOptions)
    .order('createdAt', { ascending: false })
  if (isPaginated) {
    query = query.range(safeOffset, safeOffset + safeLimit - 1)
  }

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
  if (typeof minValue === 'string' && minValue.trim()) {
    const minValueNumber = Number(minValue)
    if (!Number.isNaN(minValueNumber)) {
      query = query.gte('value', minValueNumber)
    }
  }
  if (typeof search === 'string') {
    const normalizedSearch = search.trim().toLowerCase()
    if (normalizedSearch) {
      const pattern = `%${normalizedSearch}%`
      const { data: clientRows, error: clientError } = await supabase
        .from('clients')
        .select('id')
        .ilike('name', pattern)
      if (clientError) {
        return response.status(500).json({ message: clientError.message })
      }
      const clientIds = (clientRows ?? []).map((row) => row.id).filter(isValidId)
      if (clientIds.length > 0) {
        const idList = clientIds.join(',')
        query = query.or(`publicId.ilike.${pattern},clientId.in.(${idList})`)
      } else {
        query = query.ilike('publicId', pattern)
      }
    }
  }
  if (typeof method === 'string' && method !== 'all') {
    const normalizedMethod = normalizeMethod(method)
    const { data: paymentRows, error: paymentError } = await supabase
      .from('sale_payments')
      .select('saleId')
      .eq('method', normalizedMethod)
    if (paymentError) {
      return response.status(500).json({ message: paymentError.message })
    }
    const saleIds = Array.from(new Set((paymentRows ?? []).map((row) => row.saleId).filter(isValidId)))
    if (!saleIds.length) {
      return response.json(isPaginated ? { data: [], total: 0 } : [])
    }
    query = query.in('id', saleIds)
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

router.get('/receipts', async (request, response) => {
  const idsParam = typeof request.query.ids === 'string' ? request.query.ids : ''
  const ids = idsParam
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
  if (!ids.length) {
    return response.json({})
  }
  const { data, error } = await supabase
    .from('sales')
    .select('id, receiptImage')
    .in('id', ids)
  if (error) {
    return response.status(500).json({ message: error.message })
  }
  const results: Record<string, string[]> = {}
  ;(data ?? []).forEach((sale) => {
    if (sale.receiptImage) {
      results[sale.id] = normalizeReceiptImages(sale.receiptImage)
    }
  })
  return response.json(results)
})

router.get('/:id/receipt', async (request, response) => {
  const { id } = request.params
  const { data, error } = await supabase
    .from('sales')
    .select('receiptImage')
    .eq('id', id)
    .single()
  if (error || !data?.receiptImage) {
    return response.status(404).json({ message: 'Comprovante não encontrado.' })
  }
  return response.json({ images: normalizeReceiptImages(data.receiptImage) })
})

router.post('/', async (request, response) => {
  const payload = saleSchema.parse(request.body)
  const { data: client, error: clientError } = await supabase.from('clients').select('id').eq('id', payload.clientId).single()
  if (clientError || !client) {
    return response.status(404).json({ message: 'Cliente não encontrado.' })
  }
  const isAdmin = request.user?.role === 'admin'

  const productIds = [...new Set(payload.items.map((item) => item.productId).filter(isValidId))]
  let productsMap: Map<string, any>
  try {
    productsMap = await loadProducts(productIds)
  } catch (error) {
    return response.status(500).json({ message: (error as Error).message })
  }
  let saleItems: SaleItemInput[]
  try {
    saleItems = enforceSellerMinimumPrices(payload.items, productsMap, !isAdmin)
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }
  try {
    validateStock(saleItems, productsMap)
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }

  const itemsTotal = sumItems(saleItems)
  const orderTotal = itemsTotal - payload.discount
  const paymentsTotal = payload.payments.reduce((sum, payment) => sum + payment.amount, 0)
  if (Math.abs(paymentsTotal - orderTotal) > 0.01) {
    return response.status(400).json({ message: 'Pagamentos não conferem com o total do pedido.' })
  }
  const requiresApproval = saleItems.some((item) => !item.productId)
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
    .select('id')
    .single()
  if (saleError || !createdSale) {
    return response.status(400).json({ message: saleError?.message ?? 'Não foi possível criar a venda.' })
  }

  const saleId = createdSale.id
  const { error: itemsError } = await supabase.from('sale_items').insert(toSaleItemsPayload(saleId, saleItems))
  if (itemsError) {
    return response.status(400).json({ message: itemsError.message })
  }
  const { error: paymentsError } = await supabase.from('sale_payments').insert(toPaymentPayload(saleId, payload.payments))
  if (paymentsError) {
    return response.status(400).json({ message: paymentsError.message })
  }

  try {
    await updateProductQuantities(
      saleItems,
      productsMap,
      'reserve',
      request.user?.id,
      `Saída por venda ${identifiers.publicId}`,
    )
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }

  const sale = await fetchSale(saleId)
  return response.status(201).json(sale)
})

router.post('/:id/receipt', roleGuard(['admin', 'seller']), async (request, response) => {
  const { id } = request.params
  const payload = receiptSchema.parse(request.body)
  let sale
  try {
    sale = await fetchSale(id)
  } catch (error) {
    return response.status(404).json({ message: (error as Error).message })
  }
  const incomingImages = Array.isArray(payload.imageData) ? payload.imageData : [payload.imageData]
  try {
    incomingImages.forEach(validateImageDataUrl)
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }
  const existingImages = normalizeReceiptImages(sale.receiptImage)
  const mergedImages = [...existingImages, ...incomingImages]
  const serializedImages = serializeReceiptImages(mergedImages)
  const { error } = await supabase.from('sales').update({ receiptImage: serializedImages }).eq('id', id)
  if (error) {
    return response.status(400).json({ message: error.message })
  }
  return response.json({ images: mergedImages })
})

router.delete('/:id/receipt', roleGuard(['admin', 'seller']), async (request, response) => {
  const { id } = request.params
  const { error } = await supabase.from('sales').update({ receiptImage: null }).eq('id', id)
  if (error) {
    return response.status(400).json({ message: error.message })
  }
  return response.status(204).send()
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
      request.user?.id,
      `Entrega confirmada da venda ${sale.publicId ?? id}`,
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
  const isDelivered = sale.status === SALE_STATUS_ENTREGUE
  if (sale.status === SALE_STATUS_CANCELADA) {
    return response.status(400).json({ message: 'Não é possível editar um pedido cancelado.' })
  }

  const saleItems = Array.isArray(sale.items) ? sale.items : []
  const productIds = [
    ...new Set(
      [...payload.items, ...saleItems].map((item) => item.productId).filter(isValidId),
    ),
  ]
  let productsMap: Map<string, any>
  try {
    productsMap = await loadProducts(productIds)
  } catch (error) {
    return response.status(500).json({ message: (error as Error).message })
  }
  try {
    validateStockDelta(payload.items, productsMap, saleItems)
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }

  const itemsTotal = sumItems(payload.items)
  const orderTotal = itemsTotal - payload.discount
  const paymentsTotal = payload.payments.reduce((sum, payment) => sum + payment.amount, 0)
  if (Math.abs(orderTotal - paymentsTotal) > 0.01) {
    return response.status(400).json({ message: 'Pagamentos não conferem com o total do pedido.' })
  }

  const releaseItems: SaleItemInput[] = saleItems.map((item: any) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
    customName: item.customName,
    customSku: item.customSku,
  }))
  const requiresApproval = payload.items.some((item) => !item.productId)
  try {
    if (isDelivered) {
      await updateDeliveredProductQuantities(releaseItems, payload.items, productsMap, request.user?.id, sale.publicId ?? id)
    } else {
      await updatePendingProductQuantities(id, releaseItems, payload.items, productsMap, request.user?.id, sale.publicId ?? id)
    }
  } catch (error) {
    return response.status(400).json({ message: (error as Error).message })
  }

  await supabase.from('sale_items').delete().eq('saleId', id)
  await supabase.from('sale_payments').delete().eq('saleId', id)

  const saleItemsPayload = toSaleItemsPayload(id, payload.items).map((item) =>
    isDelivered ? { ...item, requiresApproval: false } : item,
  )
  const { error: itemsError } = await supabase.from('sale_items').insert(saleItemsPayload)
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
      status: isDelivered ? SALE_STATUS_ENTREGUE : SALE_STATUS_PENDENTE,
      requiresApproval: isDelivered ? false : requiresApproval,
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
    await updateProductQuantities(
      releaseItems,
      releaseMap,
      'release',
      request.user?.id,
      `Entrada por cancelamento da venda ${sale.publicId ?? id}`,
    )
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
  if (sale.status === SALE_STATUS_CANCELADA) {
    return response.status(409).json({ message: 'Pedido cancelado não pode ser aprovado.' })
  }
  if (!sale.requiresApproval) {
    return response.status(200).json({ message: 'Este pedido já foi aprovado.', sale })
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
