import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
// The worker is bundled alongside the app so rendering stays fully offline.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
export type { PDFDocumentProxy }

export class PasswordRequiredError extends Error {
  constructor(public readonly wrong: boolean) {
    super(wrong ? 'wrong-password' : 'password-required')
    this.name = 'PasswordRequiredError'
  }
}

/**
 * Opens a document for rendering. pdf.js detaches the buffer it is handed, so
 * every call gets its own copy and the caller keeps ownership of `bytes`.
 */
export async function openForRender(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  try {
    return await pdfjs.getDocument({
      data: bytes.slice(),
      password,
      // Keep everything local: no CMap/standard-font CDN lookups.
      isEvalSupported: false,
      useSystemFonts: true
    }).promise
  } catch (error) {
    const name = (error as { name?: string }).name
    if (name === 'PasswordException') {
      const code = (error as { code?: number }).code
      // 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
      throw new PasswordRequiredError(code === 2)
    }
    throw error
  }
}
