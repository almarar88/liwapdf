import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Builds the renderer-side test bundle. The suites import the app's own
// modules, so they run against exactly the code that ships.
export default defineConfig({
  root: process.cwd(),
  base: './',
  logLevel: 'warn',
  resolve: {
    alias: {
      '@shared': resolve(process.cwd(), 'src/shared'),
      mammoth: resolve(process.cwd(), 'node_modules/mammoth/mammoth.browser.min.js')
    }
  },
  build: {
    outDir: 'out/tests',
    emptyOutDir: true,
    rollupOptions: { input: resolve(process.cwd(), 'tests/index.html') }
  }
})
