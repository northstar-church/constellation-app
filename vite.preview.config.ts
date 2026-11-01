// Builds the renderer as one self-contained HTML file for browser previews (demo data, no Electron).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), viteSingleFile()],
  define: { 'import.meta.env.VITE_PREVIEW': JSON.stringify('1') },
  build: { outDir: '../../preview', emptyOutDir: true }
})
