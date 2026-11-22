import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    strictPort: true,
    port: 5180,
    proxy: { '/api': 'http://127.0.0.1:8011' },
  },
  preview: {
    proxy: { '/api': 'http://127.0.0.1:8011' },
  },
})
