import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Two builds share this config:
//  - `bun run dev` / `bun run build` keeps the Cloudflare plugin, for the
//    hosted (Worker) build.
//  - `bun run build:pages` produces a pure static bundle for GitHub Pages:
//    no Worker, and everything served from the repository sub-path.
const pages = process.env.PAGES_BUILD === '1'

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), ...(pages ? [] : [cloudflare()])],
  server: { port: 5173, strictPort: false },
})
