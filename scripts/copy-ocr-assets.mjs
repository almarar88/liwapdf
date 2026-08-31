/**
 * Stages the offline OCR runtime into the renderer's public directory.
 *
 * The Tesseract worker, its WebAssembly core and the language models have to
 * keep their exact filenames — the worker builds `<langPath>/<code>.traineddata.gz`
 * itself — so they are copied verbatim rather than imported as hashed assets.
 * Copying at build time keeps ~12 MB of binaries out of the repository while
 * still shipping them inside the packaged app.
 *
 * This runs as part of `npm run build`. It fails loudly: a missing model would
 * otherwise turn into an OCR feature that silently does nothing.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'src/renderer/public/tesseract')

const FILES = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  [
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js'
  ],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tessdata/eng.traineddata.gz'],
  ['node_modules/@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz', 'tessdata/ara.traineddata.gz']
]

let copied = 0
for (const [from, to] of FILES) {
  const source = join(root, from)
  if (!existsSync(source)) {
    console.error(`copy-ocr-assets: missing ${from} — run npm install first`)
    process.exit(1)
  }
  const destination = join(target, to)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  copied += 1
}

console.log(`copy-ocr-assets: staged ${copied} files into src/renderer/public/tesseract`)
