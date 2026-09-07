import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The Android build of the same renderer.
 *
 * Nothing about the app changes here: the same components, readers and
 * engines are compiled, only the shell around them differs — the mobile
 * entry installs the Capacitor bridge in place of Electron's preload. The
 * output goes to `out/mobile`, which is what Capacitor copies into the APK.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/mobile'),
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
      mammoth: resolve(__dirname, 'node_modules/mammoth/mammoth.browser.min.js')
    }
  },
  plugins: [react()],
  optimizeDeps: { include: ['mammoth'] },
  // The OCR models and the pdf.js worker are copied verbatim; the phone is
  // offline-first like the desktop app.
  publicDir: resolve(__dirname, 'src/renderer/public'),
  build: {
    outDir: resolve(__dirname, 'out/mobile'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
    target: 'es2022',
    rollupOptions: { input: resolve(__dirname, 'src/mobile/index.html') }
  }
})
