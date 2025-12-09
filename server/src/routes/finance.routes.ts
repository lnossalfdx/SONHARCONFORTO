import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'
import type { PaymentMethod } from '@prisma/client'
import { ZodError } from 'zod'

const router = Router()
router.use(authMiddleware)

const goalSchema = z.object({
  target: z.number().nonnegative(),
})

const expenseSchema = z.object({
  description: z.string().trim().min(3, 'Informe o que foi pago.'),
  amount: z.number().positive('Valor deve ser positivo.'),
  date: z.string().datetime(),
  method: z.enum(['PIX', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro']),
  note: z.string().trim().optional(),
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

const getMonthRange = (baseDate = new Date()) => {
  const year = baseDate.getFullYear()
  const monthIndex = baseDate.getMonth()
  const month = monthIndex + 1
  const start = new Date(year, monthIndex, 1)
  const end = new Date(year, monthIndex + 1, 1)
  return { year, month, start, end }
}

const extractMethodFilter = (value: unknown) => {
  if (!value || typeof value !== 'string' || value === 'all') return null
  return normalizeMethod(value)
}

router.get('/summary', roleGuard('admin'), async (request, response) => {
  const { start, end, method } = request.query
  const normalizedMethod = extractMethodFilter(method)
  const dateFilter =
    start || end
      ? { createdAt: { gte: start ? new Date(String(start)) : undefined, lte: end ? new Date(String(end)) : undefined } }
      : {}

  const sales = await prisma.sale.findMany({
    where: dateFilter,
    include: { payments: true },
    orderBy: { createdAt: 'asc' },
  })

  const filteredSales = normalizedMethod
    ? sales.filter((sale) => sale.payments.some((payment) => payment.method === normalizedMethod))
    : sales

  const revenueFromSale = (sale: typeof sales[number]) =>
    normalizedMethod
      ? sale.payments
          .filter((payment) => payment.method === normalizedMethod)
          .reduce((total, payment) => total + payment.amount, 0)
      : sale.value

  const totalRevenue = filteredSales.reduce((sum, sale) => sum + revenueFromSale(sale), 0)
  const discountTotal = filteredSales.reduce((sum, sale) => sum + sale.discount, 0)
  const delivered = filteredSales.filter((sale) => sale.status === 'entregue').length
  const pending = filteredSales.filter((sale) => sale.status === 'pendente').length

  const paymentsByMethod = sales
    .flatMap((sale) => sale.payments)
    .reduce<Record<string, number>>((acc, payment) => {
      acc[payment.method] = (acc[payment.method] ?? 0) + payment.amount
      return acc
    }, {})

  const monthlySeries = filteredSales.reduce<Record<string, number>>((series, sale) => {
    const key = `${sale.createdAt.getFullYear()}-${sale.createdAt.getMonth() + 1}`
    series[key] = (series[key] ?? 0) + revenueFromSale(sale)
    return series
  }, {})

  const expenseWhere =
    start || end
      ? { date: { gte: start ? new Date(String(start)) : undefined, lte: end ? new Date(String(end)) : undefined } }
      : {}
  const expenses = await prisma.financeExpense.findMany({
    where: normalizedMethod ? { ...expenseWhere, method: normalizedMethod } : expenseWhere,
  })
  const expensesTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const expensesByMethod = expenses.reduce<Record<string, number>>((acc, expense) => {
    acc[expense.method] = (acc[expense.method] ?? 0) + expense.amount
    return acc
  }, {})

  return response.json({
    totalRevenue,
    discountTotal,
    delivered,
    pending,
    paymentsByMethod,
    monthlySeries,
    expensesTotal,
    expensesByMethod,
    netRevenue: totalRevenue - expensesTotal,
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

router.get('/expenses', roleGuard('admin'), async (request, response) => {
  const { start, end, method } = request.query
  const normalizedMethod = extractMethodFilter(method)
  const where: any = {}
  if (start || end) {
    where.date = {
      gte: start ? new Date(String(start)) : undefined,
      lte: end ? new Date(String(end)) : undefined,
    }
  }
  if (normalizedMethod) {
    where.method = normalizedMethod
  }
  const expenses = await prisma.financeExpense.findMany({
    where,
    include: { createdBy: true },
    orderBy: { date: 'desc' },
  })
  return response.json(expenses)
})

router.post('/expenses', roleGuard('admin'), async (request, response) => {
  let payload
  try {
    payload = expenseSchema.parse(request.body)
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0]
      return response.status(400).json({ message: issue?.message ?? 'Dados inválidos.' })
    }
    throw error
  }
  const expense = await prisma.financeExpense.create({
    data: {
      description: payload.description.trim(),
      amount: payload.amount,
      date: new Date(payload.date),
      method: normalizeMethod(payload.method),
      note: payload.note?.trim(),
      createdById: request.user?.id,
    },
    include: { createdBy: true },
  })
  return response.status(201).json(expense)
})

export const financeRoutes = router
