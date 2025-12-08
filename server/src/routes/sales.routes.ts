import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'
import type { PaymentMethod } from '@prisma/client'

const router = Router()
router.use(authMiddleware)

const saleItemSchema = z.object({
  productId: z.string().min(5),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
})

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

const randomPublicId = () => `VEN-${Math.floor(Math.random() * 900 + 100)}`

router.get('/', async (request, response) => {
  const { status, clientId, search, start, end } = request.query
  const where: any = {}
  if (status && status !== 'all') {
    where.status = status === 'entregue' ? 'entregue' : 'pendente'
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

  const productIds = [...new Set(payload.items.map((item) => item.productId))]
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } })
  if (products.length !== productIds.length) {
    return response.status(400).json({ message: 'Produto não encontrado no estoque.' })
  }

  const productById = Object.fromEntries(products.map((product) => [product.id, product]))
  for (const item of payload.items) {
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

  const publicId = randomPublicId()

  const sale = await prisma.$transaction(async (tx) => {
    const createdSale = await tx.sale.create({
      data: {
        publicId,
        clientId: payload.clientId,
        createdById: request.user?.id,
        discount: payload.discount,
        note: payload.note,
        deliveryDate: payload.deliveryDate ? new Date(payload.deliveryDate) : null,
        value: orderTotal,
        items: {
          create: payload.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount ?? 0,
          })),
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
  if (sale.status === 'entregue') {
    return response.json(sale)
  }
  await prisma.$transaction(async (tx) => {
    await tx.sale.update({ where: { id }, data: { status: 'entregue' } })
    for (const item of sale.items) {
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

export const salesRoutes = router
