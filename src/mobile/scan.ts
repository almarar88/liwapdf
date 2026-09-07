import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { imagesToPdf } from '../renderer/src/lib/convert'

/**
 * The scanner a phone already is.
 *
 * A desktop app converts files that arrived from somewhere else; a phone has
 * the paper in front of it. Each shot is cleaned by the same engine the
 * desktop's "enhance as a scan" uses — the tilt is measured from the ink and
 * corrected, the paper is pushed to white and the ink to black — and the
 * pages are bound into one PDF. Nothing is uploaded: the camera image goes
 * straight into the app's own image pipeline.
 */

export interface ScanResult {
  bytes: Uint8Array
  pages: number
}

/** A4 and Letter in points; "auto" keeps each photograph's own shape. */
const PAGES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792]
}

export interface ScanOptions {
  pageSize?: 'A4' | 'Letter' | 'auto'
  /** Straighten and whiten each shot; off keeps the photograph as it is. */
  enhance?: boolean
  onProgress?: (done: number, total: number) => void
}

/** Takes one photograph and returns it as bytes, or null if cancelled. */
export async function capturePage(): Promise<Uint8Array | null> {
  try {
    const photo = await Camera.getPhoto({
      quality: 92,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      correctOrientation: true,
      // A document wants resolution, not a thumbnail; 2400px on the long
      // edge is enough for OCR and still comfortable in memory.
      width: 2400
    })
    if (!photo.base64String) return null
    const binary = atob(photo.base64String)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    // A cancelled camera is not an error.
    return null
  }
}

/** Binds captured pages into a PDF, cleaning each one on the way. */
export async function pagesToPdf(pages: Uint8Array[], options: ScanOptions = {}): Promise<ScanResult> {
  const files = pages.map((bytes, index) => ({ name: `scan-${index + 1}.jpg`, bytes }))
  const size = options.pageSize ?? 'A4'
  const bytes = await imagesToPdf(
    files,
    size === 'auto' ? null : PAGES[size] ?? PAGES.A4,
    'contain',
    0,
    options.onProgress,
    options.enhance ?? true
  )
  return { bytes, pages: pages.length }
}
