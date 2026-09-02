import QRCode from 'qrcode'

/**
 * QR codes, generated locally.
 *
 * A code on an invoice, a certificate or a poster is the one thing people
 * still open a web tool for, and a web tool means pasting the invoice's
 * link — or its contents — into someone else's server. The encoder runs
 * here; nothing leaves.
 */

export interface QrMatrix {
  size: number
  /** Row-major; true is a dark module. */
  modules: boolean[]
}

/** The module grid, for drawing as vector squares into a PDF. */
export function qrMatrix(text: string): QrMatrix {
  const code = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const size = code.modules.size
  const data = code.modules.data as Uint8Array | number[]
  return { size, modules: Array.from(data, (bit) => bit === 1) }
}

/** A PNG data URL at the given pixel size, with a quiet zone. */
export async function qrDataUrl(text: string, size = 320): Promise<string> {
  return QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' })
}
