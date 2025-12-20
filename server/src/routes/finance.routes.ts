import { Router } from 'express'
import { ZodError, z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { roleGuard } from '../middleware/roleGuard.js'
import type { PaymentMethod } from '../types.js'
import { supabase } from '../lib/supabase.js'

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
  let salesQuery = supabase
    .from('sales')
    .select('*, payments:sale_payments(*)')
    .order('createdAt', { ascending: true })
  if (typeof start === 'string') {
    salesQuery = salesQuery.gte('createdAt', start)
  }
  if (typeof end === 'string') {
    salesQuery = salesQuery.lte('createdAt', end)
  }
  const { data: sales, error: salesError } = await salesQuery
  if (salesError) {
    return response.status(500).json({ message: salesError.message })
  }

  const filteredSales = normalizedMethod
    ? (sales ?? []).filter((sale) => sale.payments?.some((payment: any) => payment.method === normalizedMethod))
    : sales ?? []

  const revenueFromSale = (sale: any) =>
    normalizedMethod
      ? sale.payments
          ?.filter((payment: any) => payment.method === normalizedMethod)
          .reduce((total: number, payment: any) => total + payment.amount, 0) ?? 0
      : sale.value

  const totalRevenue = filteredSales.reduce((sum, sale) => sum + revenueFromSale(sale), 0)
  const discountTotal = filteredSales.reduce((sum, sale) => sum + sale.discount, 0)
  const delivered = filteredSales.filter((sale) => sale.status === 'entregue').length
  const pending = filteredSales.filter((sale) => sale.status === 'pendente').length

  const paymentsByMethod = (sales ?? [])
    .flatMap((sale) => sale.payments ?? [])
    .reduce<Record<string, number>>((acc, payment: any) => {
      acc[payment.method] = (acc[payment.method] ?? 0) + payment.amount
      return acc
    }, {})

  const monthlySeries = filteredSales.reduce<Record<string, number>>((series, sale) => {
    const createdAt = new Date(sale.createdAt)
    const key = `${createdAt.getFullYear()}-${createdAt.getMonth() + 1}`
    series[key] = (series[key] ?? 0) + revenueFromSale(sale)
    return series
  }, {})

  let expenseQuery = supabase.from('finance_expenses').select('*')
  if (typeof start === 'string') {
    expenseQuery = expenseQuery.gte('date', start)
  }
  if (typeof end === 'string') {
    expenseQuery = expenseQuery.lte('date', end)
  }
  if (normalizedMethod) {
    expenseQuery = expenseQuery.eq('method', normalizedMethod)
  }
  const { data: expenses, error: expensesError } = await expenseQuery
  if (expensesError) {
    return response.status(500).json({ message: expensesError.message })
  }
  const expensesTotal = (expenses ?? []).reduce((sum, expense) => sum + expense.amount, 0)
  const expensesByMethod = (expenses ?? []).reduce<Record<string, number>>((acc, expense) => {
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
  const { data: existingGoal } = await supabase
    .from('monthly_goals')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .maybeSingle()
  let goal = existingGoal
  if (!goal) {
    const insertResult = await supabase
      .from('monthly_goals')
      .insert({ year, month, target: 0 })
      .select('*')
      .single()
    goal = insertResult.data ?? { year, month, target: 0 }
  }
  const { data: salesSum } = await supabase
    .from('sales')
    .select('value')
    .gte('createdAt', start.toISOString())
    .lt('createdAt', end.toISOString())
  const progress = (salesSum ?? []).reduce((sum, sale) => sum + (sale.value ?? 0), 0)
  return response.json({
    year,
    month,
    target: goal?.target ?? 0,
    progress,
  })
})

router.put('/goal', roleGuard('admin'), async (request, response) => {
  const payload = goalSchema.parse(request.body)
  const { year, month } = getMonthRange()
  const { data, error } = await supabase
    .from('monthly_goals')
    .upsert({ year, month, target: payload.target }, { onConflict: 'year,month' })
    .select('*')
    .single()
  if (error || !data) {
    return response.status(400).json({ message: error?.message ?? 'Não foi possível atualizar meta.' })
  }
  return response.json(data)
})

router.get('/expenses', roleGuard('admin'), async (request, response) => {
  const { start, end, method } = request.query
  const normalizedMethod = extractMethodFilter(method)
  let query = supabase.from('finance_expenses').select('*, createdBy:createdById(*)').order('date', { ascending: false })
  if (typeof start === 'string') {
    query = query.gte('date', start)
  }
  if (typeof end === 'string') {
    query = query.lte('date', end)
  }
  if (normalizedMethod) {
    query = query.eq('method', normalizedMethod)
  }
  const { data, error } = await query
  if (error) {
    return response.status(500).json({ message: error.message })
  }
  return response.json(data ?? [])
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
  const { data, error } = await supabase
    .from('finance_expenses')
    .insert({
      description: payload.description.trim(),
      amount: payload.amount,
      date: new Date(payload.date).toISOString(),
      method: normalizeMethod(payload.method),
      note: payload.note?.trim() ?? null,
      createdById: request.user?.id ?? null,
    })
    .select('*, createdBy:createdById(*)')
    .single()
  if (error || !data) {
    return response.status(400).json({ message: error?.message ?? 'Não foi possível registrar saída.' })
  }
  return response.status(201).json(data)
})

export const financeRoutes = router
