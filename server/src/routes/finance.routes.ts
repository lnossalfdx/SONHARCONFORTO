import { Router } from 'express'
import { prisma } from '../config/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'

const router = Router()
router.use(authMiddleware, roleGuard('admin'))

router.get('/summary', async (request, response) => {
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

export const financeRoutes = router
