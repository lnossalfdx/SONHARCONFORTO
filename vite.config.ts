import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Aponte VITE_PROXY_TARGET para a API em produção (ex.: https://resp.sonharconforto.com.br)
  // quando quiser testar o frontend local contra a API que já está no ar.
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:3333'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  }
})
