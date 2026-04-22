export type UserRole = 'admin' | 'seller'

export type PaymentMethod = 'PIX' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'DINHEIRO'

export type SaleStatus = 'pendente' | 'entregue' | 'cancelada'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        role: UserRole
      }
    }
  }
}

export {}
