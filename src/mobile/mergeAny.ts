import { imagesToPdf } from '../renderer/src/lib/convert'

/**
 * Whatever was picked, as PDF bytes ready to be bound together.
 *
 * Merging is a PDF operation, so a picture has to become a page first. Only
 * the two kinds that can be turned into a page here — a PDF, and an image —
 * are accepted; a Word file would need the print pipeline and a round trip
 * through a layout engine, which is a different feature with a different
 * failure mode, so the picker refuses it up front rather than failing halfway
 * through a merge the user has already committed to.
 */

const IMAGE = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i
const PDF = /\.pdf$/i

/** True when this file can go into a merge without another conversion. */
export function canMerge(name: string): boolean {
  return PDF.test(name) || IMAGE.test(name)
}

/** A4 in points; a photograph is fitted onto it rather than becoming the page. */
const A4: [number, number] = [595.28, 841.89]

export async function convertToPdf(name: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (PDF.test(name)) return bytes
  if (IMAGE.test(name)) {
    return imagesToPdf([{ name, bytes }], A4, 'contain', 0, undefined, false)
  }
  throw new Error('merge-unsupported')
}
