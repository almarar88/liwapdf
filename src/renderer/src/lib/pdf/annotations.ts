import { degrees, rgb, StandardFonts } from '@cantoo/pdf-lib'
import { hexToRgb, needsComplexShaping, uid } from '../format'
import { load, save } from './ops'
import { rasterizeText } from './text-raster'

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

/** Burns the annotation list into the document, producing new PDF bytes. */
export async function flattenAnnotations(
  bytes: Uint8Array,
  annotations: Annotation[],
  password?: string
): Promise<Uint8Array> {
  const document = await load(bytes, password)
  const pages = document.getPages()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold)

  for (const annotation of annotations) {
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
      case 'redact':
        page.drawRectangle({ x, y, width, height, color: rgb(0, 0, 0) })
        break

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

        if (needsComplexShaping(value)) {
          const raster = rasterizeText(value, {
            fontSize: size,
            color: annotation.color,
            bold: annotation.bold
          })
          const image = await document.embedPng(raster.png)
          page.drawImage(image, {
            x,
            y: pageHeight - annotation.y * pageHeight - raster.height,
            width: raster.width,
            height: raster.height,
            opacity: annotation.opacity
          })
          break
        }

        page.drawText(value, {
          x,
          y: pageHeight - annotation.y * pageHeight - size,
          size,
          font: annotation.bold ? boldFont : font,
          color,
          opacity: annotation.opacity,
          lineHeight: size * 1.3,
          maxWidth: width > 10 ? width : undefined,
          rotate: degrees(0)
        })
        break
      }
    }
  }

  return save(document)
}
