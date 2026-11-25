import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The Go backend sends no CORS headers, so the dev server proxies /api to it.
    // Leave VITE_API_BASE_URL empty in real mode so requests stay same-origin.
    proxy: { '/api': { target: process.env.APAPO_BACKEND_URL ?? 'http://localhost:8080', changeOrigin: true } },
  },
  test: {
    environment: 'node',
    // Tests pin their own mode so a developer's .env (for example VITE_API_MODE=real) cannot change them.
    env: { VITE_API_MODE: 'mock', VITE_API_BASE_URL: '' },
    setupFiles: ['./src/test/setup.ts'],
  },
})
