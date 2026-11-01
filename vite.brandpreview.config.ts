// Builds the staff Brand Library page as one self-contained HTML file for a browser preview (demo data).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), viteSingleFile()],
  define: { 'import.meta.env.VITE_PREVIEW': JSON.stringify('1') },
  build: { outDir: '../../preview-brand', emptyOutDir: true, rollupOptions: { input: 'src/renderer/brand.html' } }
})
