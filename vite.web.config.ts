// Builds the app for the Cloudflare Worker to serve (out/web).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  base: '/',
  plugins: [react()],
  build: {
    outDir: '../../out/web',
    emptyOutDir: true,
    // guest.html: the page behind Video Review links (served at /track/review/<token>)
    rollupOptions: { input: { main: 'src/renderer/index.html', guest: 'src/renderer/guest.html', brand: 'src/renderer/brand.html', staff: 'src/renderer/staff.html' } }
  }
})
