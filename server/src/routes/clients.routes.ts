import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

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

router.get('/', async (request, response) => {
  const { search } = request.query
  const clients = await prisma.client.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: String(search), mode: 'insensitive' } },
            { phone: { contains: String(search), mode: 'insensitive' } },
            { cpf: { contains: String(search), mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
  })
  return response.json(clients)
})

router.post('/', async (request, response) => {
  const payload = clientSchema.parse(request.body)
  const client = await prisma.client.create({ data: payload })
  return response.status(201).json(client)
})

router.get('/:id', async (request, response) => {
  const { id } = request.params
  const client = await prisma.client.findUnique({ where: { id }, include: { sales: true } })
  if (!client) return response.status(404).json({ message: 'Cliente não encontrado.' })
  return response.json(client)
})

router.put('/:id', async (request, response) => {
  const payload = clientSchema.partial().parse(request.body)
  const { id } = request.params
  const client = await prisma.client.update({ where: { id }, data: payload })
  return response.json(client)
})

router.delete('/:id', async (request, response) => {
  const { id } = request.params
  await prisma.client.delete({ where: { id } })
  return response.status(204).send()
})

export const clientRoutes = router
