import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

const assistanceSchema = z.object({
  saleId: z.string().cuid(),
  productId: z.string().cuid(),
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
  const assists = await prisma.assistance.findMany({
    where: {
      status: status && status !== 'all' ? (status === 'concluida' ? 'concluida' : 'aberta') : undefined,
      OR: search
        ? [
            { code: { contains: String(search), mode: 'insensitive' } },
            { sale: { publicId: { contains: String(search), mode: 'insensitive' } } },
            { product: { name: { contains: String(search), mode: 'insensitive' } } },
          ]
        : undefined,
    },
    include: { sale: true, product: true, owner: true },
    orderBy: { createdAt: 'desc' },
  })
  return response.json(assists)
})

router.post('/', async (request, response) => {
  const payload = assistanceSchema.parse(request.body)
  const sale = await prisma.sale.findUnique({ where: { id: payload.saleId } })
  if (!sale) return response.status(404).json({ message: 'Venda não encontrada.' })
  const assistance = await prisma.assistance.create({
    data: {
      code: randomCode(),
      saleId: payload.saleId,
      productId: payload.productId,
      defectDescription: payload.defectDescription,
      factoryResponse: payload.factoryResponse,
      expectedDate: payload.expectedDate ? new Date(payload.expectedDate) : null,
      photos: payload.photos ?? [],
      notes: payload.notes,
      ownerId: request.user?.id,
    },
    include: { sale: true, product: true, owner: true },
  })
  return response.status(201).json(assistance)
})

router.patch('/:id/status', async (request, response) => {
  const payload = statusSchema.parse(request.body)
  const { id } = request.params
  const assistance = await prisma.assistance.update({
    where: { id },
    data: { status: payload.status, factoryResponse: payload.factoryResponse },
    include: { sale: true, product: true, owner: true },
  })
  return response.json(assistance)
})

router.get('/:id', async (request, response) => {
  const { id } = request.params
  const assistance = await prisma.assistance.findUnique({
    where: { id },
    include: { sale: true, product: true, owner: true },
  })
  if (!assistance) return response.status(404).json({ message: 'Assistência não encontrada.' })
  return response.json(assistance)
})

export const assistanceRoutes = router
