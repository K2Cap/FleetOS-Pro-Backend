import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 7332,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7331',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
