import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'
import type { PaymentMethod, Prisma, SaleStatus } from '@prisma/client'

const router = Router()
router.use(authMiddleware)

let cancelStatusEnsured = false
const ensureCancelStatusValue = async () => {
  if (cancelStatusEnsured) return
  const ddl = `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'SaleStatus' AND e.enumlabel = 'cancelada'
      ) THEN
        EXECUTE 'ALTER TYPE "SaleStatus" ADD VALUE ''cancelada''';
      END IF;
    END $$;
  `
  await prisma.$executeRawUnsafe(ddl)
  cancelStatusEnsured = true
}

void ensureCancelStatusValue().catch((error) =>
  console.error('Não foi possível garantir o status cancelada em SaleStatus:', error),
)

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

type SaleItemInput = z.infer<typeof saleItemSchema>

const buildSaleItemData = (item: SaleItemInput): Prisma.SaleItemUncheckedCreateWithoutSaleInput => {
  const data: Record<string, any> = {
    customName: item.customName ?? null,
    customSku: item.customSku ?? null,
    isCustom: !item.productId,
    requiresApproval: !item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount ?? 0,
  }
  if (item.productId) {
    data.productId = item.productId
  }
  return data as Prisma.SaleItemUncheckedCreateWithoutSaleInput
}

const SALE_STATUS_PENDENTE = 'pendente' as SaleStatus
const SALE_STATUS_ENTREGUE = 'entregue' as SaleStatus
const SALE_STATUS_CANCELADA = 'cancelada' as unknown as SaleStatus
const isValidId = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.length > 0

const paymentSchema = z.object({
  method: z.enum(['PIX', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro']),
  amount: z.number().nonnegative(),
  installments: z.number().int().positive().default(1),
})

const saleSchema = z.object({
  clientId: z.string().min(5),
  items: z.array(saleItemSchema).min(1),
  payments: z.array(paymentSchema).min(1),
  note: z.string().optional(),
  discount: z.number().nonnegative().default(0),
  deliveryDate: z.string().datetime().optional(),
})

const normalizeMethod = (method: string): PaymentMethod => {
  switch (method) {
    case 'Cartão de crédito':
      return 'CARTAO_CREDITO'
    case 'Cartão de débito':
      return 'CARTAO_DEBITO'
    case 'Dinheiro':
      return 'DINHEIRO'
    case 'PIX':
    default:
      return 'PIX'
  }
}

const formatPublicId = (sequence: number) => `VEN-${String(sequence).padStart(4, '0')}`

router.get('/', async (request, response) => {
  const { status, clientId, search, start, end } = request.query
  const where: any = {}
  if (status && status !== 'all') {
    if (status === 'entregue' || status === 'pendente' || status === 'cancelada') {
      where.status = status
    }
  }
  if (clientId) where.clientId = String(clientId)
  if (search) {
    where.OR = [
      { publicId: { contains: String(search), mode: 'insensitive' } },
      { client: { name: { contains: String(search), mode: 'insensitive' } } },
    ]
  }
  if (start || end) {
    where.createdAt = {
      gte: start ? new Date(String(start)) : undefined,
      lte: end ? new Date(String(end)) : undefined,
    }
  }
  const sales = await prisma.sale.findMany({
    where,
    include: { client: true, items: { include: { product: true } }, payments: true },
    orderBy: { createdAt: 'desc' },
  })
  return response.json(sales)
})

router.post('/', async (request, response) => {
  const payload = saleSchema.parse(request.body)
  const client = await prisma.client.findUnique({ where: { id: payload.clientId } })
  if (!client) return response.status(404).json({ message: 'Cliente não encontrado.' })

  const productIds = [...new Set(payload.items.map((item) => item.productId).filter(isValidId))]
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } })
  if (products.length !== productIds.length) {
    return response.status(400).json({ message: 'Produto não encontrado no estoque.' })
  }

  const productById = Object.fromEntries(products.map((product) => [product.id, product]))
  for (const item of payload.items) {
    if (!item.productId) continue
    const product = productById[item.productId]
    if (!product || product.quantity < item.quantity) {
      return response.status(400).json({ message: `Estoque insuficiente para ${product?.name ?? item.productId}.` })
    }
  }

  const itemsTotal = payload.items.reduce(
    (total, item) => total + item.quantity * item.unitPrice - (item.discount ?? 0),
    0,
  )
  const orderTotal = itemsTotal - payload.discount
  const paymentsTotal = payload.payments.reduce((sum, payment) => sum + payment.amount, 0)
  if (Math.abs(paymentsTotal - orderTotal) > 0.01) {
    return response.status(400).json({ message: 'Pagamentos não conferem com o total do pedido.' })
  }

  const saleRequiresApproval = payload.items.some((item) => !item.productId)

  const sale = await prisma.$transaction(async (tx) => {
    const counter = await tx.saleCounter.upsert({
      where: { id: 1 },
      update: { current: { increment: 1 } },
      create: { id: 1, current: 1 },
      select: { current: true },
    })
    const sequenceValue = counter.current
    const createdSale = await tx.sale.create({
      data: {
        sequence: sequenceValue,
        publicId: formatPublicId(sequenceValue),
        client: { connect: { id: payload.clientId } },
        createdBy: request.user ? { connect: { id: request.user.id } } : undefined,
        discount: payload.discount,
        note: payload.note,
        deliveryDate: payload.deliveryDate ? new Date(payload.deliveryDate) : null,
        value: orderTotal,
        requiresApproval: saleRequiresApproval,
        items: {
          create: payload.items.map(buildSaleItemData),
        },
        payments: {
          create: payload.payments.map((payment) => ({
            method: normalizeMethod(payment.method),
            amount: payment.amount,
            installments: payment.installments ?? 1,
          })),
        },
      },
      include: { client: true, items: true, payments: true },
    })

    for (const item of payload.items) {
      if (!item.productId) continue
      const product = productById[item.productId]
      await tx.product.update({
        where: { id: item.productId },
        data: {
          quantity: product.quantity - item.quantity,
          reserved: product.reserved + item.quantity,
        },
      })
      product.quantity -= item.quantity
      product.reserved += item.quantity
    }

    return createdSale
  })

  return response.status(201).json(sale)
})

router.post('/:id/confirm-delivery', roleGuard(['admin', 'seller']), async (request, response) => {
  const { id } = request.params
  const sale = await prisma.sale.findUnique({ where: { id }, include: { items: true } })
  if (!sale) return response.status(404).json({ message: 'Venda não encontrada.' })
  if (sale.requiresApproval) {
    return response.status(400).json({ message: 'Este pedido possui itens aguardando aprovação do administrador.' })
  }
  if (sale.status === SALE_STATUS_CANCELADA) {
    return response.status(400).json({ message: 'Este pedido foi cancelado.' })
  }
  if (sale.status === SALE_STATUS_ENTREGUE) {
    return response.json(sale)
  }
  await prisma.$transaction(async (tx) => {
    await tx.sale.update({ where: { id }, data: { status: SALE_STATUS_ENTREGUE } })
    for (const item of sale.items) {
      if (!item.productId) continue
      const product = await tx.product.findUnique({ where: { id: item.productId } })
      if (!product) continue
      await tx.product.update({
        where: { id: item.productId },
        data: {
          reserved: Math.max(0, product.reserved - item.quantity),
        },
      })
    }
  })
  const updated = await prisma.sale.findUnique({ where: { id }, include: { client: true, items: true, payments: true } })
  return response.json(updated)
})

router.get('/:id', async (request, response) => {
  const { id } = request.params
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { client: true, items: { include: { product: true } }, payments: true },
  })
  if (!sale) return response.status(404).json({ message: 'Venda não encontrada.' })
  return response.json(sale)
})

router.put('/:id', roleGuard('admin'), async (request, response) => {
  const payload = saleSchema.parse(request.body)
  const { id } = request.params
  const sale = await prisma.sale.findUnique({ where: { id }, include: { items: true } })
  if (!sale) return response.status(404).json({ message: 'Venda não encontrada.' })
  const client = await prisma.client.findUnique({ where: { id: payload.clientId } })
  if (!client) return response.status(404).json({ message: 'Cliente não encontrado.' })
  if (sale.status === SALE_STATUS_ENTREGUE) {
    return response.status(400).json({ message: 'Não é possível editar um pedido entregue.' })
  }
  if (sale.status === SALE_STATUS_CANCELADA) {
    return response.status(400).json({ message: 'Não é possível editar um pedido cancelado.' })
  }

  const itemsTotal = payload.items.reduce(
    (total, item) => total + item.quantity * item.unitPrice - (item.discount ?? 0),
    0,
  )
  const orderTotal = itemsTotal - payload.discount
  const paymentsTotal = payload.payments.reduce((sum, payment) => sum + payment.amount, 0)
  if (Math.abs(paymentsTotal - orderTotal) > 0.01) {
    return response.status(400).json({ message: 'Pagamentos não conferem com o total do pedido.' })
  }
  const requiresAdminApproval = payload.items.some((item) => !item.productId)

  try {
    const updatedSale = await prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        if (!item.productId) continue
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { reserved: true } })
        await tx.product.update({
          where: { id: item.productId },
          data: {
            quantity: { increment: item.quantity },
            reserved: { decrement: Math.min(product?.reserved ?? 0, item.quantity) },
          },
        })
      }

      const productIds = [...new Set(payload.items.map((item) => item.productId).filter(isValidId))]
      const products = await tx.product.findMany({ where: { id: { in: productIds } } })
      if (products.length !== productIds.length) {
        throw new Error('Produto não encontrado no estoque.')
      }
      const productMap = new Map(products.map((product) => [product.id, product]))
      for (const item of payload.items) {
        if (!item.productId) continue
        const product = productMap.get(item.productId)
        if (!product) throw new Error('Produto não encontrado no estoque.')
        if (product.quantity < item.quantity) {
          throw new Error(`Estoque insuficiente para ${product.name}.`)
        }
        product.quantity -= item.quantity
      }

      const updated = await tx.sale.update({
        where: { id },
        data: {
          clientId: payload.clientId,
          discount: payload.discount,
          note: payload.note,
          deliveryDate: payload.deliveryDate ? new Date(payload.deliveryDate) : null,
          value: orderTotal,
          status: SALE_STATUS_PENDENTE,
          requiresApproval: requiresAdminApproval,
          items: {
            deleteMany: {},
            create: payload.items.map(buildSaleItemData),
          },
          payments: {
            deleteMany: {},
            create: payload.payments.map((payment) => ({
              method: normalizeMethod(payment.method),
              amount: payment.amount,
              installments: payment.installments ?? 1,
            })),
          },
        },
        include: { client: true, items: true, payments: true },
      })

      for (const item of payload.items) {
        if (!item.productId) continue
        await tx.product.update({
          where: { id: item.productId },
          data: {
            quantity: { decrement: item.quantity },
            reserved: { increment: item.quantity },
          },
        })
      }

      return updated
    })
    return response.json(updatedSale)
  } catch (error) {
    console.error(error)
    return response
      .status(400)
      .json({ message: error instanceof Error ? error.message : 'Não foi possível editar a venda.' })
  }
})

router.post('/:id/cancel', roleGuard('admin'), async (request, response) => {
  const { id } = request.params
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { items: true, client: true, payments: true },
  })
  if (!sale) return response.status(404).json({ message: 'Venda não encontrada.' })
  if (sale.status === SALE_STATUS_ENTREGUE) {
    return response.status(400).json({ message: 'Não é possível cancelar um pedido entregue.' })
  }
  if (sale.status === SALE_STATUS_CANCELADA) {
    return response.json(sale)
  }

  await ensureCancelStatusValue()
  await prisma.$transaction(async (tx) => {
    await tx.sale.update({ where: { id }, data: { status: SALE_STATUS_CANCELADA } })
    for (const item of sale.items) {
      if (!item.productId) continue
      const product = await tx.product.findUnique({ where: { id: item.productId }, select: { reserved: true } })
      await tx.product.update({
        where: { id: item.productId },
        data: {
          quantity: { increment: item.quantity },
          reserved: { decrement: Math.min(product?.reserved ?? 0, item.quantity) },
        },
      })
    }
  })

  const updated = await prisma.sale.findUnique({
    where: { id },
    include: { client: true, items: true, payments: true },
  })
  return response.json(updated)
})

router.post('/:id/approve', roleGuard('admin'), async (request, response) => {
  const { id } = request.params
  const sale = await prisma.sale.findUnique({ where: { id }, include: { client: true, items: true, payments: true } })
  if (!sale) return response.status(404).json({ message: 'Venda não encontrada.' })
  if (!sale.requiresApproval) {
    return response.status(400).json({ message: 'Este pedido já foi aprovado.' })
  }
  await prisma.$transaction(async (tx) => {
    await tx.sale.update({
      where: { id },
      data: {
        requiresApproval: false,
      },
    })
    await tx.saleItem.updateMany({
      where: { saleId: id },
      data: { requiresApproval: false },
    })
  })
  const updated = await prisma.sale.findUnique({
    where: { id },
    include: { client: true, items: true, payments: true },
  })
  return response.json(updated)
})

export const salesRoutes = router
