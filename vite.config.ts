import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
  build: {
    target: 'ES2022',
    rollupOptions: {
      output: {
        manualChunks: {
          babylon: ['@babylonjs/core', '@babylonjs/loaders', '@babylonjs/materials', '@babylonjs/gui'],
          vendor: ['@supabase/supabase-js', 'socket.io-client'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['@babylonjs/core', '@babylonjs/loaders'],
  },
  define: {
    global: 'globalThis',
  },
})