import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  // Set BASE_PATH=/sauchatz/ when hosting in a sub-folder (for example GitHub Pages).
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 800 },
})
