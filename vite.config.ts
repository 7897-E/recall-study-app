import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// One static build. VITE_BASE is the public path: GitHub Pages serves a project
// site under /<repo>/, a user site or custom domain uses '/'.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: false },
})
