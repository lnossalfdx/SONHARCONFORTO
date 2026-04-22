import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type SupabaseConfig = {
  url: string
  anonKey: string
}

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')

let client: SupabaseClient | null = null
let pending: Promise<SupabaseClient> | null = null

const resolveConfig = async (): Promise<SupabaseConfig> => {
  const envUrl = import.meta.env.VITE_SUPABASE_URL
  const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (envUrl && envAnonKey) {
    return { url: envUrl, anonKey: envAnonKey }
  }
  const response = await fetch(`${apiBaseUrl}/config/supabase`)
  if (!response.ok) {
    throw new Error('Não foi possível carregar as credenciais do Supabase.')
  }
  const payload = await response.json()
  if (!payload?.url || !payload?.anonKey) {
    throw new Error('Configuração do Supabase incompleta.')
  }
  return { url: payload.url, anonKey: payload.anonKey }
}

export const getSupabaseClient = async () => {
  if (client) return client
  if (!pending) {
    pending = resolveConfig()
      .then(({ url, anonKey }) => {
        client = createClient(url, anonKey)
        pending = null
        return client
      })
      .catch((error) => {
        pending = null
        throw error
      })
  }
  return pending
}
