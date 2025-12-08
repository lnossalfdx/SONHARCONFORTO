import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export const authMiddleware = (request: Request, response: Response, next: NextFunction) => {
  const authHeader = request.headers.authorization
  if (!authHeader) {
    return response.status(401).json({ message: 'Token não fornecido.' })
  }

  const [, token] = authHeader.split(' ')
  if (!token) {
    return response.status(401).json({ message: 'Token inválido.' })
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: string; role: string }
    request.user = { id: payload.sub, role: payload.role as any }
    return next()
  } catch (error) {
    return response.status(401).json({ message: 'Sessão expirada. Faça login novamente.' })
  }
}
