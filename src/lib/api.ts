const FALLBACK_API_BASE_URL = '/api'

const normalizeBaseUrl = (value: string) => value.replace(/\/$/, '')

const isLocalHostname = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

export const resolveApiBaseUrl = () => {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim()
  if (!configuredUrl) {
    return FALLBACK_API_BASE_URL
  }

  const normalizedConfiguredUrl = normalizeBaseUrl(configuredUrl)

  if (typeof window === 'undefined') {
    return normalizedConfiguredUrl
  }

  if (import.meta.env.VITE_ALLOW_CROSS_ORIGIN_API === 'true') {
    return normalizedConfiguredUrl
  }

  if (isLocalHostname(window.location.hostname) || normalizedConfiguredUrl.startsWith('/')) {
    return normalizedConfiguredUrl
  }

  try {
    const parsedUrl = new URL(normalizedConfiguredUrl, window.location.origin)
    if (parsedUrl.origin !== window.location.origin) {
      console.warn(
        `VITE_API_URL aponta para ${parsedUrl.origin}. Usando ${FALLBACK_API_BASE_URL} para evitar CORS no deploy.`,
      )
      return FALLBACK_API_BASE_URL
    }

    return normalizeBaseUrl(parsedUrl.pathname || FALLBACK_API_BASE_URL)
  } catch {
    return normalizedConfiguredUrl
  }
}

export const API_BASE_URL = resolveApiBaseUrl()
