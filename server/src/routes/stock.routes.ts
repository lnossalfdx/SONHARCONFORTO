import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'

const router = Router()

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
  quantity: z.number().int().nonnegative().default(0),
  imageUrl: z.string().url().optional(),
})

const generateSku = () => `SKU-${Math.floor(Math.random() * 90000 + 10000)}`

router.get('/', authMiddleware, async (request, response) => {
  const { search } = request.query
  const products = await prisma.product.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: String(search), mode: 'insensitive' } },
            { sku: { contains: String(search), mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
  })
  return response.json(products)
})

router.post('/', authMiddleware, roleGuard('admin'), async (request, response) => {
  const payload = productSchema.parse(request.body)
  const { sku, ...rest } = payload
  const normalizedSku = sku ?? generateSku()
  const product = await prisma.product.create({
    data: { ...rest, sku: normalizedSku, reserved: 0 },
  })
  return response.status(201).json(product)
})

const movementSchema = z.object({
  type: z.enum(['entrada', 'saida']),
  amount: z.number().int().positive(),
  note: z.string().optional(),
})

router.post('/:id/movements', authMiddleware, roleGuard('admin'), async (request, response) => {
  const payload = movementSchema.parse(request.body)
  const { id } = request.params
  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) return response.status(404).json({ message: 'Produto não encontrado.' })

  if (payload.type === 'saida' && product.quantity < payload.amount) {
    return response.status(400).json({ message: 'Quantidade em estoque insuficiente para saída.' })
  }

  const delta = payload.type === 'entrada' ? payload.amount : -payload.amount
  const [updated] = await prisma.$transaction([
    prisma.product.update({
      where: { id },
      data: { quantity: product.quantity + delta },
    }),
    prisma.stockMovement.create({
      data: {
        productId: id,
        userId: request.user!.id,
        type: payload.type,
        amount: payload.amount,
        note: payload.note,
      },
    }),
  ])

  return response.json(updated)
})

router.get('/movements', authMiddleware, async (request, response) => {
  const { type } = request.query
  const movements = await prisma.stockMovement.findMany({
    where: type ? { type: type === 'entrada' ? 'entrada' : 'saida' } : undefined,
    include: { product: true },
    orderBy: { createdAt: 'desc' },
  })
  return response.json(movements)
})

router.delete('/:id', authMiddleware, roleGuard('admin'), async (request, response) => {
  const { id } = request.params
  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) return response.status(404).json({ message: 'Produto não encontrado.' })
  if (product.quantity > 0 || product.reserved > 0) {
    return response.status(400).json({ message: 'Só é possível remover produtos zerados.' })
  }
  await prisma.product.delete({ where: { id } })
  return response.status(204).send()
})

export const stockRoutes = router
