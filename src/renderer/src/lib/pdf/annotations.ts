import { degrees, rgb } from '@cantoo/pdf-lib'
import { hexToRgb, uid } from '../format'
import { load, readerToPage, save, visibleBox } from './ops'
import { applyRedactions, type RedactionReport, type RedactRegion } from './redact'
import {
  drawSmartText,
  isRtlText,
  measureSmartText,
  prepareFonts,
  wrapSmartText
} from './typography'

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
    // Annotations are stored against what the reader sees, so they have to be
    // placed through the visible box rather than the raw page size: a MediaBox
    // that does not start at (0, 0) — routine in scanned and office-produced
    // files — put every mark at an offset, and a rotated page transposed them.
    const box = visibleBox(page)
    const pageWidth = box.width
    const pageHeight = box.height
    const { r, g, b } = hexToRgb(annotation.color)
    const color = rgb(r, g, b)

    const width = annotation.width * pageWidth
    const height = annotation.height * pageHeight
    /** Reader-space point (measured from the visible box's bottom-left) to page space. */
    const at = (
      normalizedX: number,
      normalizedY: number,
      boxHeight = 0
    ): { x: number; y: number; rotate: number } =>
      readerToPage(box, normalizedX * pageWidth, pageHeight - normalizedY * pageHeight - boxHeight)

    const placed = at(annotation.x, annotation.y, height)
    const { x, y } = placed
    const rotate = degrees(placed.rotate)

    switch (annotation.kind) {
      case 'highlight':
        page.drawRectangle({ x, y, width, height, color, rotate, opacity: annotation.opacity * 0.42 })
        break

      case 'rect':
        page.drawRectangle({
          x,
          y,
          width,
          height,
          rotate,
          borderColor: color,
          borderWidth: annotation.strokeWidth,
          color: annotation.filled ? color : undefined,
          opacity: annotation.filled ? annotation.opacity : undefined,
          borderOpacity: annotation.opacity
        })
        break

      case 'ellipse': {
        const centre = at(
          annotation.x + annotation.width / 2,
          annotation.y + annotation.height / 2
        )
        page.drawEllipse({
          x: centre.x,
          y: centre.y,
          xScale: (box.rotation === 90 || box.rotation === 270 ? height : width) / 2,
          yScale: (box.rotation === 90 || box.rotation === 270 ? width : height) / 2,
          borderColor: color,
          borderWidth: annotation.strokeWidth,
          color: annotation.filled ? color : undefined,
          opacity: annotation.filled ? annotation.opacity : undefined,
          borderOpacity: annotation.opacity
        })
        break
      }

      case 'line': {
        const from = at(annotation.x, annotation.y)
        const to = at(annotation.x + annotation.width, annotation.y + annotation.height)
        page.drawLine({
          start: { x: from.x, y: from.y },
          end: { x: to.x, y: to.y },
          thickness: annotation.strokeWidth,
          color,
          opacity: annotation.opacity
        })
        break
      }

      case 'draw': {
        const points = annotation.points ?? []
        for (let index = 1; index < points.length; index += 1) {
          const from = at(points[index - 1][0], points[index - 1][1])
          const to = at(points[index][0], points[index][1])
          page.drawLine({
            start: { x: from.x, y: from.y },
            end: { x: to.x, y: to.y },
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
        page.drawImage(image, { x, y, width, height, rotate, opacity: annotation.opacity })
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
          // An Arabic line starts at the right edge of the box the user drew.
          // Drawing every line from the left made a right-to-left note look
          // ragged down its reading edge, which is the edge the eye follows.
          const measured = await measureSmartText(fonts, line, style)
          const indent = rtl ? Math.max(0, boxWidth - measured.width) : 0
          // The line's own extents have to go in: on a rotated page the text
          // runs along a different axis, so the anchor is a corner of the line
          // box rather than a bare point.
          const spot = at(
            annotation.x + indent / pageWidth,
            annotation.y + (size + lineIndex * lineHeight) / pageHeight
          )
          await drawSmartText(page, fonts, line, spot.x, spot.y, {
            ...style,
            rotate: placed.rotate,
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
