import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3011,
    open: true,
    proxy: {
      '/api':     { target: 'http://localhost:3012', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3012', changeOrigin: true },
      '/runtime': { target: 'http://localhost:3012', changeOrigin: true },
      '/docs':    { target: 'http://localhost:3012', changeOrigin: true },
    }
  }
})
