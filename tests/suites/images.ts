import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import jsQR from 'jsqr'
import type { Suite } from '../harness'
import { eq as makeEq } from '../harness'
import { qrDataUrl, qrMatrix } from '../../src/renderer/src/lib/qr'
import { stampQr } from '../../src/renderer/src/lib/pdf/ops'
import { enhanceScan } from '../../src/renderer/src/lib/images/scan'
import { estimateSkew, deskew } from '../../src/renderer/src/lib/images/deskew'
import { openForRender } from '../../src/renderer/src/lib/pdf/pdfjs'
import { renderPage } from '../../src/renderer/src/lib/pdf/render'

function decode(canvas: HTMLCanvasElement): string | null {
  const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(data.data, data.width, data.height)?.data ?? null
}

/** A page of text-like lines, drawn at a known tilt. */
function tiltedPage(degrees: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 1000
  const context = canvas.getContext('2d')!
  context.fillStyle = '#fff'
  context.fillRect(0, 0, 800, 1000)
  context.translate(400, 500)
  context.rotate((degrees * Math.PI) / 180)
  context.fillStyle = '#000'
  for (let y = -380; y <= 380; y += 28) {
    for (let x = -300; x < 300; x += 22) context.fillRect(x, y, 14, 10)
  }
  // Left transformed on purpose: a caller's leftover transform must not throw deskew off.
  return canvas
}

const suite: Suite = {
  name: 'images',
  async run(check) {
    const eq = makeEq(check)
    const url = 'https://alcode.app/invoice/12345?x=ريال'
    const matrix = qrMatrix(url)
    check('qr matrix square', matrix.modules.length === matrix.size * matrix.size)
    const img = new Image()
    img.src = await qrDataUrl(url, 320)
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 320
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    eq('qr png decodes back', decode(canvas), url)

    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage([595, 842]).drawText('Invoice 12345', { x: 50, y: 790, size: 20, font })
    const stamped = await stampQr(await pdf.save(), { text: url, sizePt: 120, anchor: 'bottomRight', margin: 30, indices: [0] })
    const proxy = await openForRender(stamped)
    const rendered = await renderPage(proxy, 1, 2)
    const region = document.createElement('canvas')
    region.width = 400
    region.height = 400
    region.getContext('2d')!.drawImage(rendered.canvas, rendered.width - 400, rendered.height - 400, 400, 400, 0, 0, 400, 400)
    eq('qr on pdf page decodes', decode(region), url)
    await proxy.destroy()

    const photo = document.createElement('canvas')
    photo.width = 200
    photo.height = 200
    const pc = photo.getContext('2d')!
    pc.fillStyle = 'rgb(168,160,140)'
    pc.fillRect(0, 0, 200, 200)
    pc.fillStyle = 'rgb(70,66,60)'
    pc.fillRect(40, 90, 120, 20)
    enhanceScan(photo)
    const px = pc.getImageData(0, 0, 200, 200).data
    check('paper becomes white', px[(10 * 200 + 10) * 4] >= 250, String(px[(10 * 200 + 10) * 4]))
    check('ink becomes black', px[(100 * 200 + 100) * 4] <= 30, String(px[(100 * 200 + 100) * 4]))

    const tilted = tiltedPage(3)
    const angle = estimateSkew(tilted)
    check('skew estimated near 3 degrees', Math.abs(angle - 3) <= 0.6, String(angle))
    deskew(tilted)
    const after = estimateSkew(tilted)
    check('deskewed page is level', Math.abs(after) <= 0.6, String(after))
    eq('level page needs no correction', estimateSkew(tiltedPage(0)), 0)
  }
}
export default suite
