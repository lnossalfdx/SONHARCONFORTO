import type { Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase.js'

export const authMiddleware = async (request: Request, response: Response, next: NextFunction) => {
  const authHeader = request.headers.authorization
  if (!authHeader) {
    return response.status(401).json({ message: 'Token não fornecido.' })
  }

  const [, token] = authHeader.split(' ')
  if (!token) {
    return response.status(401).json({ message: 'Token inválido.' })
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    return response.status(401).json({ message: 'Sessão expirada. Faça login novamente.' })
  }

  const { data: dbUser, error: dbError } = await supabase
    .from('users')
    .select('id, role, active')
    .eq('id', data.user.id)
    .single()

  if (dbError || !dbUser) {
    return response.status(403).json({ message: 'Usuário não autorizado.' })
  }

  if (dbUser.active === false) {
    return response.status(403).json({ message: 'Usuário desativado.' })
  }

  request.user = { id: dbUser.id, role: dbUser.role as any }
  return next()
}
