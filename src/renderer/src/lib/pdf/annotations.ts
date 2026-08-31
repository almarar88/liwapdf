import { rgb } from '@cantoo/pdf-lib'
import { hexToRgb, uid } from '../format'
import { load, save } from './ops'
import { applyRedactions, type RedactionReport, type RedactRegion } from './redact'
import { drawSmartText, isRtlText, prepareFonts, wrapSmartText } from './typography'

export type AnnotationKind =
  | 'text'
  | 'highlight'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'draw'
  | 'image'
  | 'redact'

/**
 * All geometry is stored normalized (0..1) against the page box with the origin
 * at the top-left, so annotations survive zooming and page re-rendering.
 */
export interface Annotation {
  id: string
  page: number
  kind: AnnotationKind
  x: number
  y: number
  width: number
  height: number
  color: string
  opacity: number
  strokeWidth: number
  filled: boolean
  text?: string
  fontSize?: number
  bold?: boolean
  points?: [number, number][]
  imageDataUrl?: string
}

export function createAnnotation(partial: Partial<Annotation> & Pick<Annotation, 'page' | 'kind'>): Annotation {
  return {
    id: uid(),
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.1,
    color: '#e5484d',
    opacity: 1,
    strokeWidth: 2,
    filled: false,
    ...partial
  }
}

export interface FlattenResult {
  bytes: Uint8Array
  /** Present when the list contained redactions; describes what was destroyed. */
  redaction?: RedactionReport
}

/**
 * Burns the annotation list into the document, producing new PDF bytes.
 *
 * Redactions are deliberately not part of that pass: painting them here would
 * leave the covered text in the file. They are collected and handed to the
 * real redaction pipeline afterwards, which removes the content itself and
 * verifies that it is gone.
 */
export async function flattenAnnotations(
  bytes: Uint8Array,
  annotations: Annotation[],
  password?: string,
  onProgress?: (fraction: number) => void
): Promise<FlattenResult> {
  const redactions = annotations.filter((annotation) => annotation.kind === 'redact')
  const drawable = annotations.filter((annotation) => annotation.kind !== 'redact')
  const document = await load(bytes, password)
  const pages = document.getPages()
  const fonts = await prepareFonts(document)

  for (const annotation of drawable) {
    const page = pages[annotation.page - 1]
    if (!page) continue
    const pageWidth = page.getWidth()
    const pageHeight = page.getHeight()
    const { r, g, b } = hexToRgb(annotation.color)
    const color = rgb(r, g, b)

    const x = annotation.x * pageWidth
    const width = annotation.width * pageWidth
    const height = annotation.height * pageHeight
    const y = pageHeight - annotation.y * pageHeight - height

    switch (annotation.kind) {
      case 'highlight':
        page.drawRectangle({ x, y, width, height, color, opacity: annotation.opacity * 0.42 })
        break

      case 'rect':
        page.drawRectangle({
          x,
          y,
          width,
          height,
          borderColor: color,
          borderWidth: annotation.strokeWidth,
          color: annotation.filled ? color : undefined,
          opacity: annotation.filled ? annotation.opacity : undefined,
          borderOpacity: annotation.opacity
        })
        break

      case 'ellipse':
        page.drawEllipse({
          x: x + width / 2,
          y: y + height / 2,
          xScale: width / 2,
          yScale: height / 2,
          borderColor: color,
          borderWidth: annotation.strokeWidth,
          color: annotation.filled ? color : undefined,
          opacity: annotation.filled ? annotation.opacity : undefined,
          borderOpacity: annotation.opacity
        })
        break

      case 'line':
        page.drawLine({
          start: { x, y: pageHeight - annotation.y * pageHeight },
          end: { x: x + width, y: pageHeight - (annotation.y + annotation.height) * pageHeight },
          thickness: annotation.strokeWidth,
          color,
          opacity: annotation.opacity
        })
        break

      case 'draw': {
        const points = annotation.points ?? []
        for (let index = 1; index < points.length; index += 1) {
          page.drawLine({
            start: {
              x: points[index - 1][0] * pageWidth,
              y: pageHeight - points[index - 1][1] * pageHeight
            },
            end: { x: points[index][0] * pageWidth, y: pageHeight - points[index][1] * pageHeight },
            thickness: annotation.strokeWidth,
            color,
            opacity: annotation.opacity
          })
        }
        break
      }

      case 'image': {
        if (!annotation.imageDataUrl) break
        const image = annotation.imageDataUrl.includes('image/jpeg')
          ? await document.embedJpg(annotation.imageDataUrl)
          : await document.embedPng(annotation.imageDataUrl)
        page.drawImage(image, { x, y, width, height, opacity: annotation.opacity })
        break
      }

      case 'text': {
        const value = annotation.text ?? ''
        if (!value.trim()) break
        const size = annotation.fontSize ?? 14
        const rtl = isRtlText(value)
        const style = { size, color: annotation.color, bold: annotation.bold, rtl }

        // Wrap to the box the user drew, so the flattened result matches the
        // preview instead of running off the page.
        const boxWidth = Math.max(20, width)
        const lines = await wrapSmartText(fonts, value, boxWidth, style)
        const lineHeight = size * 1.32

        for (const [lineIndex, line] of lines.entries()) {
          const lineY = pageHeight - annotation.y * pageHeight - size - lineIndex * lineHeight
          await drawSmartText(page, fonts, line, x, lineY, {
            ...style,
            opacity: annotation.opacity
          })
        }
        break
      }
    }
  }

  const drawn = await save(document)
  if (redactions.length === 0) return { bytes: drawn }

  const regions: RedactRegion[] = redactions.map((annotation) => ({
    pageIndex: annotation.page - 1,
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height
  }))
  const redaction = await applyRedactions(drawn, regions, password, onProgress)
  return { bytes: redaction.bytes, redaction }
}
