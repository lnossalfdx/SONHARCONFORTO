import { Router } from 'express'
import { authRoutes } from './auth.routes.js'
import { userRoutes } from './users.routes.js'
import { clientRoutes } from './clients.routes.js'
import { stockRoutes } from './stock.routes.js'
import { salesRoutes } from './sales.routes.js'
import { assistanceRoutes } from './assistances.routes.js'
import { financeRoutes } from './finance.routes.js'

export const router = Router()

router.use('/auth', authRoutes)
router.use('/users', userRoutes)
router.use('/clients', clientRoutes)
router.use('/stock', stockRoutes)
router.use('/sales', salesRoutes)
router.use('/assistances', assistanceRoutes)
router.use('/finance', financeRoutes)
