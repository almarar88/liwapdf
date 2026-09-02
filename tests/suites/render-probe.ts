import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { type Suite, saveArtifact } from '../harness'
import { openForRender } from '../../src/renderer/src/lib/pdf/pdfjs'
import { renderPage } from '../../src/renderer/src/lib/pdf/render'

/**
 * Page rendering must not depend on the direction of the interface around
 * the canvas. The app is right-to-left; a canvas that inherited that once
 * right-aligned every glyph pdf.js painted, and text came out as a pile of
 * overlapping letters. Render the same page under both directions with the
 * canvas attached to the document, and demand identical pixels.
 */
const suite: Suite = {
  name: 'render',
  async run(check) {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([400, 200])
    page.drawText('Alcode Editor — Test Document', { x: 30, y: 140, size: 20, font })
    page.drawText('The quick brown fox jumps over the lazy dog.', { x: 30, y: 100, size: 12, font })
    const bytes = await doc.save()

    const render = async (dir: 'ltr' | 'rtl'): Promise<ImageData> => {
      document.documentElement.dir = dir
      const canvas = document.createElement('canvas')
      document.body.append(canvas)
      try {
        const proxy = await openForRender(bytes)
        await renderPage(proxy, 1, 2, canvas)
        await proxy.destroy()
        return canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height)
      } finally {
        canvas.remove()
        document.documentElement.dir = 'ltr'
      }
    }
    const ltr = await render('ltr')
    const rtl = await render('rtl')
    let differing = 0
    for (let i = 0; i < ltr.data.length; i += 4) if (ltr.data[i] !== rtl.data[i]) differing += 1
    check('rtl interface renders the page like ltr', differing === 0, `${differing} pixels differ`)

    // The title's ink should span roughly its advance width: glyphs piled on
    // one another would make it far narrower.
    let left = ltr.width
    let right = 0
    for (let y = 0; y < ltr.height; y += 1) {
      for (let x = 0; x < ltr.width; x += 1) {
        if (ltr.data[(y * ltr.width + x) * 4] < 128) {
          if (x < left) left = x
          if (x > right) right = x
        }
      }
    }
    const expected = font.widthOfTextAtSize('The quick brown fox jumps over the lazy dog.', 12) * 2
    check('ink spans the text width', right - left > expected * 0.9, `${right - left} px vs ${Math.round(expected)}`)

    const out = document.createElement('canvas')
    out.width = rtl.width
    out.height = rtl.height
    out.getContext('2d')!.putImageData(rtl, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
    if (blob) saveArtifact('render-rtl.png', new Uint8Array(await blob.arrayBuffer()))
  }
}

export default suite
