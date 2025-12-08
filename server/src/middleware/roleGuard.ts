import type { Request, Response, NextFunction } from 'express'
import type { UserRole } from '@prisma/client'

export const roleGuard = (allowed: UserRole | UserRole[]) => {
  const roles = Array.isArray(allowed) ? allowed : [allowed]
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.user || !roles.includes(request.user.role)) {
      return response.status(403).json({ message: 'Acesso não autorizado para este recurso.' })
    }
    return next()
  }
}
