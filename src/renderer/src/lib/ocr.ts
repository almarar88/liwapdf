import type { Worker } from 'tesseract.js'
import { load, save, type PdfBytes } from './pdf/ops'
import { openForRender } from './pdf/pdfjs'
import { renderPage } from './pdf/render'
import { drawInvisibleText, prepareFonts } from './pdf/typography'

/**
 * Offline optical character recognition.
 *
 * A scanned document is a picture of text: nothing in it can be searched,
 * selected or copied, and every "extract text" tool returns nothing. This runs
 * Tesseract entirely inside the app — the worker, the WebAssembly core and the
 * Arabic and English models are all bundled, so a confidential scan is never
 * uploaded anywhere to be read.
 *
 * Arabic is the reason this exists: it is the script most commonly met as a
 * scan and the least well served by the online tools, and the recognised words
 * come back through the same shaping and bidi pipeline the rest of the app
 * uses, so the searchable layer carries logical Arabic rather than presentation
 * forms.
 */

export type OcrLanguage = 'ara' | 'eng' | 'ara+eng'

export interface OcrWord {
  text: string
  confidence: number
  /** Pixel box in the rendered page image, origin at the top-left. */
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrPage {
  pageNumber: number
  text: string
  words: OcrWord[]
  /** Size of the image OCR actually saw, in pixels. */
  width: number
  height: number
  confidence: number
}

export interface OcrOptions {
  language: OcrLanguage
  /** Higher is more accurate and slower; 300 is the usual sweet spot. */
  dpi?: number
  pages?: number[]
  password?: string
  onProgress?: (done: number, total: number, stage: string) => void
  signal?: AbortSignal
  /** Layout assumption. AUTO suits mixed pages; SINGLE_BLOCK a plain one. */
  pageSegmentation?: PageSegmentation
}

/**
 * Tesseract's page-segmentation modes, mirrored so the enum can be referenced
 * without pulling the library into the startup bundle.
 */
export const PSM = {
  AUTO: '3',
  SINGLE_BLOCK: '6'
} as const

export type PageSegmentation = (typeof PSM)[keyof typeof PSM]

/** tesseract.js types the parameter as its own enum; the wire value is a string. */
type TesseractPsm = Parameters<Worker['setParameters']>[0]['tessedit_pageseg_mode']
const psm = (value: PageSegmentation): TesseractPsm => value as unknown as TesseractPsm

/**
 * Where the bundled Tesseract runtime lives.
 *
 * The models and the WebAssembly core are static assets rather than bundled
 * modules — they have to keep their exact filenames, because the worker builds
 * `<langPath>/<code>.traineddata.gz` itself. Resolving them from this module's
 * own URL keeps that working whether the app is running from a dev server or
 * from a file: URL inside a packaged build.
 */
function runtimeBase(): URL {
  if (import.meta.env.DEV) return new URL('/tesseract/', window.location.href)
  // Built output: this module lives in assets/, one level below index.html.
  return new URL('../tesseract/', import.meta.url)
}

let shared: { worker: Worker; language: OcrLanguage } | null = null

async function workerFor(
  language: OcrLanguage,
  onProgress?: (fraction: number, stage: string) => void
): Promise<Worker> {
  if (shared && shared.language === language) return shared.worker
  if (shared) {
    await shared.worker.terminate().catch(() => undefined)
    shared = null
  }

  // Loaded on demand: nobody pays for the recogniser until they ask for it.
  const { createWorker } = await import('tesseract.js')
  const base = runtimeBase()
  const worker = await createWorker(language.split('+'), 1, {
    workerPath: new URL('worker.min.js', base).href,
    corePath: new URL('tesseract-core-simd-lstm.wasm.js', base).href,
    langPath: new URL('tessdata', base).href.replace(/\/$/, ''),
    // The models ship gzipped, and nothing is ever fetched from a CDN.
    gzip: true,
    // A blob worker cannot importScripts() a file: URL, so the worker is
    // loaded straight from its own file.
    workerBlobURL: false,
    cacheMethod: 'none',
    logger: (message) => onProgress?.(message.progress ?? 0, message.status ?? '')
  })

  shared = { worker, language }
  return worker
}

/** Frees the recogniser and its ~40 MB of model memory. */
export async function releaseOcr(): Promise<void> {
  if (!shared) return
  const { worker } = shared
  shared = null
  await worker.terminate().catch(() => undefined)
}

/** Recognises the text on each requested page of a PDF. */
export async function recognizeDocument(
  bytes: PdfBytes,
  options: OcrOptions
): Promise<OcrPage[]> {
  const scale = (options.dpi ?? 300) / 72
  const source = await openForRender(bytes, options.password)
  const results: OcrPage[] = []

  try {
    const pageNumbers =
      options.pages && options.pages.length > 0
        ? options.pages.filter((page) => page >= 1 && page <= source.numPages)
        : Array.from({ length: source.numPages }, (_, index) => index + 1)

    const worker = await workerFor(options.language, (fraction, stage) =>
      options.onProgress?.(0, pageNumbers.length, `${stage} ${Math.round(fraction * 100)}%`)
    )
    // Treat each page as a block of text with mixed orientation rather than
    // hunting for columns: scanned forms and letters do far better this way.
    await worker.setParameters({
      tessedit_pageseg_mode: psm(options.pageSegmentation ?? PSM.AUTO),
      preserve_interword_spaces: '1',
      user_defined_dpi: String(options.dpi ?? 300)
    })

    // One canvas for the whole run — a page at 300 DPI is 8.7 megapixels, and
    // a fresh canvas per page leaves that much dead memory behind each time.
    const canvas = document.createElement('canvas')

    for (const [index, pageNumber] of pageNumbers.entries()) {
      if (options.signal?.aborted) break
      options.onProgress?.(index, pageNumbers.length, 'recognizing')

      const rendered = await renderPage(source, pageNumber, scale, canvas)
      let outcome = await worker.recognize(rendered.canvas, {}, { text: true, blocks: true })
      let words = wordsOf(outcome.data)

      // Automatic page segmentation analyses layout before it reads anything,
      // and on a sparse page — a title slide, a certificate, a single stamped
      // line — it finds no columns and gives up, returning nothing at all.
      // Falling back to "this is one block of text" recovers those pages.
      if (words.length === 0) {
        await worker.setParameters({ tessedit_pageseg_mode: psm(PSM.SINGLE_BLOCK) })
        outcome = await worker.recognize(rendered.canvas, {}, { text: true, blocks: true })
        words = wordsOf(outcome.data)
        await worker.setParameters({
          tessedit_pageseg_mode: psm(options.pageSegmentation ?? PSM.AUTO)
        })
      }

      results.push({
        pageNumber,
        text: outcome.data.text ?? '',
        words,
        width: rendered.width,
        height: rendered.height,
        confidence: outcome.data.confidence ?? 0
      })
      // Let the UI paint the progress it was just handed.
      await new Promise((next) => setTimeout(next, 0))
    }

    options.onProgress?.(pageNumbers.length, pageNumbers.length, 'done')
    return results
  } finally {
    await source.destroy().catch(() => undefined)
  }
}

/**
 * tesseract.js 7 reports words inside blocks/paragraphs/lines rather than as a
 * flat list, so they are collected by walking the tree.
 */
function wordsOf(data: unknown): OcrWord[] {
  const words: OcrWord[] = []
  const blocks = (data as { blocks?: unknown[] }).blocks ?? []

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const entry = node as {
      text?: string
      confidence?: number
      bbox?: { x0: number; y0: number; x1: number; y1: number }
      words?: unknown[]
      lines?: unknown[]
      paragraphs?: unknown[]
    }
    if (entry.words) {
      for (const word of entry.words) {
        const item = word as {
          text?: string
          confidence?: number
          bbox?: { x0: number; y0: number; x1: number; y1: number }
        }
        const text = (item.text ?? '').trim()
        if (!text || !item.bbox) continue
        words.push({
          text,
          confidence: item.confidence ?? 0,
          x0: item.bbox.x0,
          y0: item.bbox.y0,
          x1: item.bbox.x1,
          y1: item.bbox.y1
        })
      }
    }
    for (const child of [...(entry.paragraphs ?? []), ...(entry.lines ?? [])]) visit(child)
  }

  for (const block of blocks) visit(block)
  return words
}

export interface SearchableResult {
  bytes: PdfBytes
  /** Words placed into the invisible layer, across all pages. */
  placedWords: number
  pages: number
}

/**
 * Adds an invisible text layer to a scanned PDF so it can be searched, selected
 * and copied — the page still looks exactly as it did.
 */
export async function makeSearchable(
  bytes: PdfBytes,
  options: OcrOptions
): Promise<SearchableResult> {
  const recognized = await recognizeDocument(bytes, {
    ...options,
    onProgress: (done, total, stage) =>
      options.onProgress?.(done, total + 1, stage)
  })

  const document = await load(bytes, options.password)
  const pages = document.getPages()
  const fonts = await prepareFonts(document)
  const proxy = await openForRender(bytes, options.password)
  let placedWords = 0

  try {
    for (const page of recognized) {
      const target = pages[page.pageNumber - 1]
      if (!target) continue
      const rendered = await proxy.getPage(page.pageNumber)
      // The same viewport the image was produced from, so the pixel boxes
      // convert back to page coordinates exactly.
      const viewport = rendered.getViewport({ scale: page.width / rendered.getViewport({ scale: 1 }).width })

      for (const word of page.words) {
        // Below this the recognition is noise, and a wrong word in the
        // invisible layer is worse than a gap: it makes search lie.
        if (word.confidence < 30) continue
        const bottomLeft = viewport.convertToPdfPoint(word.x0, word.y1) as number[]
        const topRight = viewport.convertToPdfPoint(word.x1, word.y0) as number[]
        const x = Math.min(bottomLeft[0], topRight[0])
        const y = Math.min(bottomLeft[1], topRight[1])
        const width = Math.abs(topRight[0] - bottomLeft[0])
        const height = Math.abs(topRight[1] - bottomLeft[1])
        if (width < 0.5 || height < 0.5) continue
        await drawInvisibleText(target, fonts, word.text, { x, y, width, height })
        placedWords += 1
      }
      rendered.cleanup()
    }
  } finally {
    await proxy.destroy().catch(() => undefined)
  }

  options.onProgress?.(recognized.length + 1, recognized.length + 1, 'done')
  return { bytes: await save(document), placedWords, pages: recognized.length }
}

/**
 * How much of a document's text a plain extractor can already reach. Below a
 * few characters per page it is a scan, and OCR is the only way in.
 */
export function looksScanned(pageTexts: string[]): boolean {
  if (pageTexts.length === 0) return false
  const total = pageTexts.reduce((sum, text) => sum + text.replace(/\s+/g, '').length, 0)
  return total / pageTexts.length < 24
}
