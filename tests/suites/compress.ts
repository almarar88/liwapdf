import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from '@cantoo/pdf-lib'
import type { Suite } from '../harness'
import { compressPdf } from '../../src/renderer/src/lib/pdf/compress'
import { openForRender } from '../../src/renderer/src/lib/pdf/pdfjs'
import { extractText } from '../../src/renderer/src/lib/pdf/render'
import { canvasToBlob, blobToBytes } from '../../src/renderer/src/lib/pdf/text-raster'

function paintPhoto(width: number, height: number, alpha: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  const gradient = context.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#f4a261')
  gradient.addColorStop(0.5, '#2a9d8f')
  gradient.addColorStop(1, '#264653')
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  let seed = 7
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 16807) % 2147483647
    const noise = ((seed / 2147483647) - 0.5) * 60
    data[i] = Math.max(0, Math.min(255, data[i] + noise))
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise))
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise))
    if (alpha) data[i + 3] = (i / 4) % width < width / 2 ? 255 : 120
  }
  context.putImageData(image, 0, 0)
  return canvas
}

function imageStreams(document: PDFDocument): PDFRawStream[] {
  const streams: PDFRawStream[] = []
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) streams.push(object)
  }
  return streams
}
const widthOf = (stream: PDFRawStream): number => Number(stream.dict.get(PDFName.of('Width'))?.toString() ?? 0)

const suite: Suite = {
  name: 'compress',
  async run(check) {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage([595, 842])
    page.drawText('Sharp text stays selectable', { x: 50, y: 790, size: 20, font })
    const jpeg = await pdf.embedJpg(await blobToBytes(await canvasToBlob(paintPhoto(2400, 1600, false), 'image/jpeg', 0.95)))
    page.drawImage(jpeg, { x: 50, y: 420, width: 495, height: 330 })
    const png = await pdf.embedPng(await blobToBytes(await canvasToBlob(paintPhoto(1400, 900, false), 'image/png', 1)))
    page.drawImage(png, { x: 50, y: 200, width: 300, height: 190 })
    const masked = await pdf.embedPng(await blobToBytes(await canvasToBlob(paintPhoto(600, 400, true), 'image/png', 1)))
    page.drawImage(masked, { x: 380, y: 200, width: 160, height: 106 })
    const bytes = await pdf.save()
    const before = bytes.byteLength

    const smart = await compressPdf(bytes, { level: 'balanced', grayscale: false, rasterize: false })
    check('smart shrinks the file', smart.after < before * 0.6, `${before} -> ${smart.after}`)
    check('smart counted rewritten pictures', smart.imagesRecompressed === 2, String(smart.imagesRecompressed))
    const doc = await PDFDocument.load(smart.bytes)
    const streams = imageStreams(doc)
    check('three pictures plus their mask still present', streams.length === 4, String(streams.length))
    const jpegs = streams.filter((s) => s.dict.get(PDFName.of('Filter'))?.toString() === '/DCTDecode')
    const maskedOut = streams.filter((s) => s.dict.has(PDFName.of('SMask')))
    check('two are JPEG now', jpegs.length === 2, String(jpegs.length))
    check('rewritten widths capped at 1600', jpegs.every((s) => widthOf(s) <= 1600), jpegs.map(widthOf).join(','))
    check('the masked picture is untouched', maskedOut.length === 1 && maskedOut[0].dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode')
    const rendered = await openForRender(smart.bytes)
    const text = (await extractText(rendered)).map((p) => p.lines.join(' ')).join(' ')
    check('text still text after smart compress', text.includes('Sharp text stays selectable'), text)
    await rendered.destroy()
    const strong = await compressPdf(bytes, { level: 'extreme', grayscale: true, rasterize: false })
    check('extreme is smaller than balanced', strong.after < smart.after, `${strong.after} < ${smart.after}`)
    const raster = await compressPdf(bytes, { level: 'balanced', grayscale: false, rasterize: true })
    check('raster path still works', raster.after < before, String(raster.after))
  }
}
export default suite
