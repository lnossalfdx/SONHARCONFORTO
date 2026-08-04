import { getAccessToken, refreshAccessToken } from './supabase.ts'

type UnauthorizedHandler = () => void

let unauthorizedHandler: UnauthorizedHandler | null = null

export const setUnauthorizedHandler = (handler: UnauthorizedHandler | null) => {
  unauthorizedHandler = handler
}

const withAuthorization = (init: RequestInit | undefined, token: string | null): RequestInit => {
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return { ...init, headers }
}

/**
 * Chama a API sempre com um token válido: busca o access token atual no Supabase,
 * e se ainda assim receber 401, tenta renovar a sessão uma vez antes de desistir.
 * Só desloga quando a renovação também falha.
 */
export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const token = await getAccessToken()
  const response = await fetch(input, withAuthorization(init, token))
  if (response.status !== 401) return response

  const refreshedToken = await refreshAccessToken()
  if (refreshedToken && refreshedToken !== token) {
    const retryResponse = await fetch(input, withAuthorization(init, refreshedToken))
    if (retryResponse.status !== 401) return retryResponse
    unauthorizedHandler?.()
    return retryResponse
  }

  unauthorizedHandler?.()
  return response
}
