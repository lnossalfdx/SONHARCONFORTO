import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'

const router = Router()
router.use(authMiddleware)

const goalSchema = z.object({
  target: z.number().nonnegative(),
})

const getMonthRange = (baseDate = new Date()) => {
  const year = baseDate.getFullYear()
  const monthIndex = baseDate.getMonth()
  const month = monthIndex + 1
  const start = new Date(year, monthIndex, 1)
  const end = new Date(year, monthIndex + 1, 1)
  return { year, month, start, end }
}

router.get('/summary', roleGuard('admin'), async (request, response) => {
  const { start, end } = request.query
  const dateFilter = start || end ? { createdAt: { gte: start ? new Date(String(start)) : undefined, lte: end ? new Date(String(end)) : undefined } } : {}

  const sales = await prisma.sale.findMany({
    where: dateFilter,
    include: { payments: true },
    orderBy: { createdAt: 'asc' },
  })

  const totalRevenue = sales.reduce((sum, sale) => sum + sale.value, 0)
  const discountTotal = sales.reduce((sum, sale) => sum + sale.discount, 0)
  const delivered = sales.filter((sale) => sale.status === 'entregue').length
  const pending = sales.filter((sale) => sale.status === 'pendente').length

  const paymentsByMethod = sales.flatMap((sale) => sale.payments).reduce<Record<string, number>>((acc, payment) => {
    acc[payment.method] = (acc[payment.method] ?? 0) + payment.amount
    return acc
  }, {})

  const monthlySeries = sales.reduce<Record<string, number>>((series, sale) => {
    const key = `${sale.createdAt.getFullYear()}-${sale.createdAt.getMonth() + 1}`
    series[key] = (series[key] ?? 0) + sale.value
    return series
  }, {})

  return response.json({
    totalRevenue,
    discountTotal,
    delivered,
    pending,
    paymentsByMethod,
    monthlySeries,
  })
})

router.get('/goal', async (_request, response) => {
  const { year, month, start, end } = getMonthRange()
  const goal = await prisma.monthlyGoal.upsert({
    where: { year_month: { year, month } },
    update: {},
    create: { year, month, target: 0 },
  })
  const aggregate = await prisma.sale.aggregate({
    _sum: { value: true },
    where: {
      createdAt: { gte: start, lt: end },
    },
  })
  const progress = aggregate._sum.value ?? 0
  return response.json({
    year,
    month,
    target: goal.target,
    progress,
  })
})

router.put('/goal', roleGuard('admin'), async (request, response) => {
  const payload = goalSchema.parse(request.body)
  const { year, month } = getMonthRange()
  const goal = await prisma.monthlyGoal.upsert({
    where: { year_month: { year, month } },
    update: { target: payload.target },
    create: { year, month, target: payload.target },
  })
  return response.json(goal)
})

export const financeRoutes = router
